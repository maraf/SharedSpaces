using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Http;
using Microsoft.IdentityModel.Tokens;
using SharedSpaces.Server.Domain;
using SharedSpaces.Server.Infrastructure.FileStorage;
using SharedSpaces.Server.Infrastructure.Persistence;

namespace SharedSpaces.Server.Tests;

public class CrossServerTransferTests
{
    private const string SourceServerUrl = "https://source.test";
    private const string DestServerUrl = "https://destination.test";
    private const string JwtSigningKey = "test-signing-key-1234567890abcdef";

    [Fact]
    public async Task CrossServerTransfer_CopyTextItem_UploadsToRemoteAndKeepsSource()
    {
        var handler = new FakeRemoteServerHandler();
        handler.SetResponse(HttpStatusCode.Created, new
        {
            id = Guid.NewGuid(),
            spaceId = Guid.NewGuid(),
            memberId = Guid.NewGuid(),
            contentType = "text",
            content = "Hello World",
            fileSize = 0,
            sharedAt = DateTime.UtcNow
        });

        await using var factory = new CrossServerTestFactory(handler);
        using var client = factory.CreateClient();

        var sourceSpace = await factory.CreateSpaceAsync("Source Space");
        var sourceMember = await factory.CreateMemberAsync(sourceSpace.Id, "Alice");
        var sourceToken = GenerateJwt(sourceMember.Id, sourceSpace.Id, "Alice", SourceServerUrl);

        var itemId = Guid.NewGuid();
        await factory.CreateItemAsync(sourceSpace.Id, sourceMember.Id, "text", "Hello World", DateTime.UtcNow, 0, itemId);

        var destSpaceId = Guid.NewGuid();
        var destMemberId = Guid.NewGuid();
        var destToken = GenerateJwt(destMemberId, destSpaceId, "Bob", DestServerUrl);

        var response = await TransferAsync(client, sourceSpace.Id, itemId, destToken, "copy", sourceToken);

        response.StatusCode.Should().Be(HttpStatusCode.Created);

        // Source item should still exist
        var sourceExists = await factory.WithDbContextAsync(db =>
            db.SpaceItems.AnyAsync(i => i.Id == itemId && i.SpaceId == sourceSpace.Id));
        sourceExists.Should().BeTrue();

        // Should have made a PUT request to the destination server
        handler.LastRequest.Should().NotBeNull();
        handler.LastRequest!.Method.Should().Be(HttpMethod.Put);
        handler.LastRequest.RequestUri!.ToString().Should().StartWith($"{DestServerUrl}/v1/spaces/{destSpaceId}/items/");
        handler.LastRequest.Headers.Authorization!.Scheme.Should().Be("Bearer");
        handler.LastRequest.Headers.Authorization.Parameter.Should().Be(destToken);
    }

    [Fact]
    public async Task CrossServerTransfer_CopyFileItem_StreamsFileToRemote()
    {
        var handler = new FakeRemoteServerHandler();
        handler.SetResponse(HttpStatusCode.Created, new
        {
            id = Guid.NewGuid(),
            spaceId = Guid.NewGuid(),
            memberId = Guid.NewGuid(),
            contentType = "file",
            content = "document.txt",
            fileSize = 17,
            sharedAt = DateTime.UtcNow
        });

        await using var factory = new CrossServerTestFactory(handler);
        using var client = factory.CreateClient();

        var sourceSpace = await factory.CreateSpaceAsync("Source Space");
        var sourceMember = await factory.CreateMemberAsync(sourceSpace.Id, "Alice");
        var sourceToken = GenerateJwt(sourceMember.Id, sourceSpace.Id, "Alice", SourceServerUrl);

        var itemId = Guid.NewGuid();
        var fileBytes = Encoding.UTF8.GetBytes("File content here");
        await factory.CreateFileItemAsync(sourceSpace.Id, sourceMember.Id, itemId, fileBytes, "document.txt");

        var destSpaceId = Guid.NewGuid();
        var destToken = GenerateJwt(Guid.NewGuid(), destSpaceId, "Bob", DestServerUrl);

        var response = await TransferAsync(client, sourceSpace.Id, itemId, destToken, "copy", sourceToken);

        response.StatusCode.Should().Be(HttpStatusCode.Created);

        // Source item and file should still exist
        var sourceExists = await factory.WithDbContextAsync(db =>
            db.SpaceItems.AnyAsync(i => i.Id == itemId && i.SpaceId == sourceSpace.Id));
        sourceExists.Should().BeTrue();
        (await factory.FileExistsAsync(sourceSpace.Id, itemId)).Should().BeTrue();

        // Verify the request included file content
        handler.LastRequest.Should().NotBeNull();
        handler.LastRequestContent.Should().NotBeNull();
        handler.LastRequestContent!.Should().ContainKey("file");
    }

    [Fact]
    public async Task CrossServerTransfer_MoveTextItem_DeletesSourceAfterRemoteUpload()
    {
        var handler = new FakeRemoteServerHandler();
        handler.SetResponse(HttpStatusCode.Created, new
        {
            id = Guid.NewGuid(),
            spaceId = Guid.NewGuid(),
            memberId = Guid.NewGuid(),
            contentType = "text",
            content = "Moving text",
            fileSize = 0,
            sharedAt = DateTime.UtcNow
        });

        await using var factory = new CrossServerTestFactory(handler);
        using var client = factory.CreateClient();

        var sourceSpace = await factory.CreateSpaceAsync("Source Space");
        var sourceMember = await factory.CreateMemberAsync(sourceSpace.Id, "Alice");
        var sourceToken = GenerateJwt(sourceMember.Id, sourceSpace.Id, "Alice", SourceServerUrl);

        var itemId = Guid.NewGuid();
        await factory.CreateItemAsync(sourceSpace.Id, sourceMember.Id, "text", "Moving text", DateTime.UtcNow, 0, itemId);

        var destSpaceId = Guid.NewGuid();
        var destToken = GenerateJwt(Guid.NewGuid(), destSpaceId, "Bob", DestServerUrl);

        var response = await TransferAsync(client, sourceSpace.Id, itemId, destToken, "move", sourceToken);

        response.StatusCode.Should().Be(HttpStatusCode.Created);

        // Source item should be deleted
        var sourceExists = await factory.WithDbContextAsync(db =>
            db.SpaceItems.AnyAsync(i => i.Id == itemId && i.SpaceId == sourceSpace.Id));
        sourceExists.Should().BeFalse();
    }

    [Fact]
    public async Task CrossServerTransfer_MoveFileItem_DeletesSourceFileAfterRemoteUpload()
    {
        var handler = new FakeRemoteServerHandler();
        handler.SetResponse(HttpStatusCode.Created, new
        {
            id = Guid.NewGuid(),
            spaceId = Guid.NewGuid(),
            memberId = Guid.NewGuid(),
            contentType = "file",
            content = "moving.txt",
            fileSize = 12,
            sharedAt = DateTime.UtcNow
        });

        await using var factory = new CrossServerTestFactory(handler);
        using var client = factory.CreateClient();

        var sourceSpace = await factory.CreateSpaceAsync("Source Space");
        var sourceMember = await factory.CreateMemberAsync(sourceSpace.Id, "Alice");
        var sourceToken = GenerateJwt(sourceMember.Id, sourceSpace.Id, "Alice", SourceServerUrl);

        var itemId = Guid.NewGuid();
        var fileBytes = Encoding.UTF8.GetBytes("File to move");
        await factory.CreateFileItemAsync(sourceSpace.Id, sourceMember.Id, itemId, fileBytes, "moving.txt");

        var destSpaceId = Guid.NewGuid();
        var destToken = GenerateJwt(Guid.NewGuid(), destSpaceId, "Bob", DestServerUrl);

        var response = await TransferAsync(client, sourceSpace.Id, itemId, destToken, "move", sourceToken);

        response.StatusCode.Should().Be(HttpStatusCode.Created);

        // Source item and file should be deleted
        var sourceExists = await factory.WithDbContextAsync(db =>
            db.SpaceItems.AnyAsync(i => i.Id == itemId && i.SpaceId == sourceSpace.Id));
        sourceExists.Should().BeFalse();
        (await factory.FileExistsAsync(sourceSpace.Id, itemId)).Should().BeFalse();
    }

    [Fact]
    public async Task CrossServerTransfer_RemoteServerRejects_ReturnsError_SourceUnchanged()
    {
        var handler = new FakeRemoteServerHandler();
        handler.SetResponse(HttpStatusCode.RequestEntityTooLarge, new { Error = "Space storage quota exceeded" });

        await using var factory = new CrossServerTestFactory(handler);
        using var client = factory.CreateClient();

        var sourceSpace = await factory.CreateSpaceAsync("Source Space");
        var sourceMember = await factory.CreateMemberAsync(sourceSpace.Id, "Alice");
        var sourceToken = GenerateJwt(sourceMember.Id, sourceSpace.Id, "Alice", SourceServerUrl);

        var itemId = Guid.NewGuid();
        await factory.CreateItemAsync(sourceSpace.Id, sourceMember.Id, "text", "Test", DateTime.UtcNow, 0, itemId);

        var destSpaceId = Guid.NewGuid();
        var destToken = GenerateJwt(Guid.NewGuid(), destSpaceId, "Bob", DestServerUrl);

        var response = await TransferAsync(client, sourceSpace.Id, itemId, destToken, "move", sourceToken);

        response.StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge);

        // Source should NOT be deleted (move failed)
        var sourceExists = await factory.WithDbContextAsync(db =>
            db.SpaceItems.AnyAsync(i => i.Id == itemId && i.SpaceId == sourceSpace.Id));
        sourceExists.Should().BeTrue();
    }

    [Fact]
    public async Task CrossServerTransfer_RemoteServerUnreachable_Returns502()
    {
        var handler = new FakeRemoteServerHandler();
        handler.SimulateConnectionFailure = true;

        await using var factory = new CrossServerTestFactory(handler);
        using var client = factory.CreateClient();

        var sourceSpace = await factory.CreateSpaceAsync("Source Space");
        var sourceMember = await factory.CreateMemberAsync(sourceSpace.Id, "Alice");
        var sourceToken = GenerateJwt(sourceMember.Id, sourceSpace.Id, "Alice", SourceServerUrl);

        var itemId = Guid.NewGuid();
        await factory.CreateItemAsync(sourceSpace.Id, sourceMember.Id, "text", "Test", DateTime.UtcNow, 0, itemId);

        var destSpaceId = Guid.NewGuid();
        var destToken = GenerateJwt(Guid.NewGuid(), destSpaceId, "Bob", DestServerUrl);

        var response = await TransferAsync(client, sourceSpace.Id, itemId, destToken, "move", sourceToken);

        response.StatusCode.Should().Be(HttpStatusCode.BadGateway);

        // Source should NOT be deleted
        var sourceExists = await factory.WithDbContextAsync(db =>
            db.SpaceItems.AnyAsync(i => i.Id == itemId && i.SpaceId == sourceSpace.Id));
        sourceExists.Should().BeTrue();
    }

    [Fact]
    public async Task CrossServerTransfer_ItemNotFound_Returns404()
    {
        var handler = new FakeRemoteServerHandler();
        await using var factory = new CrossServerTestFactory(handler);
        using var client = factory.CreateClient();

        var sourceSpace = await factory.CreateSpaceAsync("Source Space");
        var sourceMember = await factory.CreateMemberAsync(sourceSpace.Id, "Alice");
        var sourceToken = GenerateJwt(sourceMember.Id, sourceSpace.Id, "Alice", SourceServerUrl);

        var destSpaceId = Guid.NewGuid();
        var destToken = GenerateJwt(Guid.NewGuid(), destSpaceId, "Bob", DestServerUrl);

        var response = await TransferAsync(client, sourceSpace.Id, Guid.NewGuid(), destToken, "copy", sourceToken);

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        handler.LastRequest.Should().BeNull("no request should reach the remote server");
    }

    [Fact]
    public async Task CrossServerTransfer_InvalidAction_Returns400()
    {
        var handler = new FakeRemoteServerHandler();
        await using var factory = new CrossServerTestFactory(handler);
        using var client = factory.CreateClient();

        var sourceSpace = await factory.CreateSpaceAsync("Source Space");
        var sourceMember = await factory.CreateMemberAsync(sourceSpace.Id, "Alice");
        var sourceToken = GenerateJwt(sourceMember.Id, sourceSpace.Id, "Alice", SourceServerUrl);

        var itemId = Guid.NewGuid();
        await factory.CreateItemAsync(sourceSpace.Id, sourceMember.Id, "text", "Test", DateTime.UtcNow, 0, itemId);

        var destSpaceId = Guid.NewGuid();
        var destToken = GenerateJwt(Guid.NewGuid(), destSpaceId, "Bob", DestServerUrl);

        var response = await TransferAsync(client, sourceSpace.Id, itemId, destToken, "invalid", sourceToken);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        handler.LastRequest.Should().BeNull("no request should reach the remote server");
    }

    #region Helpers

    private static string GenerateJwt(Guid memberId, Guid spaceId, string displayName, string serverUrl)
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(JwtSigningKey));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(
            claims:
            [
                new Claim(JwtRegisteredClaimNames.Sub, memberId.ToString()),
                new Claim("display_name", displayName),
                new Claim("server_url", serverUrl),
                new Claim("space_id", spaceId.ToString())
            ],
            signingCredentials: credentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    private static async Task<HttpResponseMessage> TransferAsync(
        HttpClient client, Guid sourceSpaceId, Guid itemId,
        string destToken, string action, string sourceToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post,
            $"/v1/spaces/{sourceSpaceId}/items/{itemId}/transfer");
        request.Content = JsonContent.Create(new { destinationToken = destToken, action });
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", sourceToken);
        return await client.SendAsync(request);
    }

    #endregion

    #region Test Infrastructure

    private sealed class FakeRemoteServerHandler : HttpMessageHandler
    {
        private HttpStatusCode _statusCode = HttpStatusCode.OK;
        private object? _responseBody;

        public bool SimulateConnectionFailure { get; set; }
        public HttpRequestMessage? LastRequest { get; private set; }
        public Dictionary<string, string>? LastRequestContent { get; private set; }

        public void SetResponse(HttpStatusCode statusCode, object? body = null)
        {
            _statusCode = statusCode;
            _responseBody = body;
        }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (SimulateConnectionFailure)
            {
                throw new HttpRequestException("Connection refused");
            }

            LastRequest = request;

            // Capture multipart content fields
            if (request.Content is MultipartFormDataContent multipart)
            {
                LastRequestContent = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                foreach (var content in multipart)
                {
                    var name = content.Headers.ContentDisposition?.Name?.Trim('"') ?? "";
                    if (content is StringContent stringContent)
                    {
                        LastRequestContent[name] = await stringContent.ReadAsStringAsync(cancellationToken);
                    }
                    else if (content is StreamContent)
                    {
                        LastRequestContent[name] = "(stream)";
                    }
                }
            }

            var responseJson = _responseBody is not null
                ? JsonSerializer.Serialize(_responseBody, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase })
                : "{}";

            return new HttpResponseMessage(_statusCode)
            {
                Content = new StringContent(responseJson, Encoding.UTF8, "application/json")
            };
        }
    }

    private sealed class CrossServerTestFactory(FakeRemoteServerHandler remoteHandler) : WebApplicationFactory<Program>
    {
        private readonly string _databaseName = $"sharedspaces-cross-server-{Guid.NewGuid()}";

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");

            builder.ConfigureAppConfiguration((_, configBuilder) =>
            {
                configBuilder.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Admin:Secret"] = "test-admin-secret",
                    ["Jwt:SigningKey"] = JwtSigningKey,
                    ["Storage:BasePath"] = "./artifacts/storage-tests",
                    ["Storage:MaxSpaceQuotaBytes"] = "104857600"
                });
            });

            builder.ConfigureServices(services =>
            {
                services.RemoveAll<DbContextOptions<AppDbContext>>();
                services.RemoveAll<IDbContextOptionsConfiguration<AppDbContext>>();
                services.RemoveAll<AppDbContext>();
                services.RemoveAll<IFileStorage>();

                services.AddDbContext<AppDbContext>(options => options.UseInMemoryDatabase(_databaseName));
                services.AddSingleton<IFileStorage>(_ => new InMemoryFileStorage());

                // Inject fake handler for outgoing HTTP requests
                services.AddTransient<HttpMessageHandler>(_ => remoteHandler);
                services.ConfigureAll<HttpClientFactoryOptions>(options =>
                {
                    options.HttpMessageHandlerBuilderActions.Add(b => b.PrimaryHandler = remoteHandler);
                });
            });
        }

        public async Task<Space> CreateSpaceAsync(string name = "Test Space", long? maxUploadSize = null)
        {
            return await WithDbContextAsync(async db =>
            {
                var space = new Space
                {
                    Id = Guid.NewGuid(),
                    Name = name,
                    MaxUploadSize = maxUploadSize
                };
                db.Spaces.Add(space);
                await db.SaveChangesAsync();
                return space;
            });
        }

        public async Task<SpaceMember> CreateMemberAsync(Guid spaceId, string displayName)
        {
            return await WithDbContextAsync(async db =>
            {
                var member = new SpaceMember
                {
                    Id = Guid.NewGuid(),
                    SpaceId = spaceId,
                    DisplayName = displayName,
                    JoinedAt = DateTime.UtcNow,
                    IsRevoked = false
                };
                db.SpaceMembers.Add(member);
                await db.SaveChangesAsync();
                return member;
            });
        }

        public async Task<SpaceItem> CreateItemAsync(
            Guid spaceId, Guid memberId, string contentType,
            string content, DateTime sharedAt, long fileSize, Guid? itemId = null)
        {
            return await WithDbContextAsync(async db =>
            {
                var item = new SpaceItem(itemId ?? Guid.NewGuid())
                {
                    SpaceId = spaceId,
                    MemberId = memberId,
                    ContentType = contentType,
                    Content = content,
                    SharedAt = sharedAt,
                    FileSize = fileSize
                };
                db.SpaceItems.Add(item);
                await db.SaveChangesAsync();
                return item;
            });
        }

        public async Task<SpaceItem> CreateFileItemAsync(
            Guid spaceId, Guid memberId, Guid itemId, byte[] fileBytes, string fileName)
        {
            var item = await CreateItemAsync(spaceId, memberId, "file", fileName, DateTime.UtcNow, fileBytes.Length, itemId);
            using var scope = Services.CreateScope();
            var fileStorage = scope.ServiceProvider.GetRequiredService<IFileStorage>();
            await using var stream = new MemoryStream(fileBytes);
            await fileStorage.SaveAsync(spaceId, itemId, stream, CancellationToken.None);
            return item;
        }

        public async Task<bool> FileExistsAsync(Guid spaceId, Guid itemId)
        {
            using var scope = Services.CreateScope();
            var fileStorage = scope.ServiceProvider.GetRequiredService<IFileStorage>();
            try
            {
                await using var stream = await fileStorage.ReadAsync(spaceId, itemId, CancellationToken.None);
                return true;
            }
            catch (FileNotFoundException)
            {
                return false;
            }
        }

        public async Task WithDbContextAsync(Func<AppDbContext, Task> action)
        {
            using var scope = Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await action(db);
        }

        public async Task<T> WithDbContextAsync<T>(Func<AppDbContext, Task<T>> action)
        {
            using var scope = Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            return await action(db);
        }

        private sealed class InMemoryFileStorage : IFileStorage
        {
            private readonly object _syncRoot = new();
            private readonly Dictionary<string, byte[]> _files = new(StringComparer.OrdinalIgnoreCase);
            private static string GetKey(Guid spaceId, Guid itemId) => $"{spaceId:N}/{itemId:N}";

            public async Task SaveAsync(Guid spaceId, Guid itemId, Stream content, CancellationToken ct)
            {
                ct.ThrowIfCancellationRequested();
                await using var buffer = new MemoryStream();
                await content.CopyToAsync(buffer, ct);
                lock (_syncRoot) { _files[GetKey(spaceId, itemId)] = buffer.ToArray(); }
            }

            public Task<Stream> ReadAsync(Guid spaceId, Guid itemId, CancellationToken ct)
            {
                ct.ThrowIfCancellationRequested();
                var key = GetKey(spaceId, itemId);
                lock (_syncRoot)
                {
                    if (!_files.TryGetValue(key, out var bytes))
                        throw new FileNotFoundException($"Stored file '{key}' was not found.", key);
                    return Task.FromResult<Stream>(new MemoryStream(bytes));
                }
            }

            public Task DeleteAsync(Guid spaceId, Guid itemId, CancellationToken ct)
            {
                ct.ThrowIfCancellationRequested();
                lock (_syncRoot) { _files.Remove(GetKey(spaceId, itemId)); }
                return Task.CompletedTask;
            }
        }
    }

    #endregion
}
