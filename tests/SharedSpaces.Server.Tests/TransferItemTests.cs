using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.Tokens;
using SharedSpaces.Server.Domain;
using SharedSpaces.Server.Infrastructure.FileStorage;
using SharedSpaces.Server.Infrastructure.Persistence;

namespace SharedSpaces.Server.Tests;

public class TransferItemTests
{
    [Fact]
    public async Task TransferItem_CopyTextItem_CreatesNewItemInDestination_SourceUnchanged()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var sourceSpace = await factory.CreateSpaceAsync("Source Space");
        var destSpace = await factory.CreateSpaceAsync("Dest Space");
        var sourceMember = await factory.CreateMemberAsync(sourceSpace.Id, "Alice");
        var destMember = await factory.CreateMemberAsync(destSpace.Id, "Bob");

        var sourceToken = GenerateTestJwt(sourceMember.Id, sourceSpace.Id, sourceMember.DisplayName);
        var destToken = GenerateTestJwt(destMember.Id, destSpace.Id, destMember.DisplayName);

        var itemId = Guid.NewGuid();
        var item = await factory.CreateItemAsync(
            sourceSpace.Id,
            sourceMember.Id,
            contentType: "text",
            content: "Hello World",
            sharedAt: DateTime.UtcNow.AddMinutes(-5),
            fileSize: 0,
            itemId: itemId);

        var response = await TransferItemAsync(
            client,
            sourceSpace.Id,
            itemId,
            new TransferItemRequest
            {
                DestinationToken = destToken,
                Action = "copy"
            },
            sourceToken);

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var body = await ReadJsonAsync<SpaceItemResponse>(response);
        body.Id.Should().NotBe(itemId);
        body.SpaceId.Should().Be(destSpace.Id);
        body.MemberId.Should().Be(destMember.Id);
        body.ContentType.Should().Be("text");
        body.Content.Should().Be("Hello World");
        body.FileSize.Should().Be(0);

        var sourceItemStillExists = await factory.WithDbContextAsync(db =>
            db.SpaceItems.AnyAsync(i => i.Id == itemId && i.SpaceId == sourceSpace.Id));
        sourceItemStillExists.Should().BeTrue();

        var destItemExists = await factory.WithDbContextAsync(db =>
            db.SpaceItems.AnyAsync(i => i.Id == body.Id && i.SpaceId == destSpace.Id));
        destItemExists.Should().BeTrue();
    }

    [Fact]
    public async Task TransferItem_CopyFileItem_CreatesNewItemAndFileCopy_SourceUnchanged()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var sourceSpace = await factory.CreateSpaceAsync("Source Space");
        var destSpace = await factory.CreateSpaceAsync("Dest Space");
        var sourceMember = await factory.CreateMemberAsync(sourceSpace.Id, "Alice");
        var destMember = await factory.CreateMemberAsync(destSpace.Id, "Bob");

        var sourceToken = GenerateTestJwt(sourceMember.Id, sourceSpace.Id, sourceMember.DisplayName);
        var destToken = GenerateTestJwt(destMember.Id, destSpace.Id, destMember.DisplayName);

        var itemId = Guid.NewGuid();
        var fileBytes = Encoding.UTF8.GetBytes("File content here");
        await factory.CreateFileItemAsync(sourceSpace.Id, sourceMember.Id, itemId, fileBytes, "document.txt");

        var response = await TransferItemAsync(
            client,
            sourceSpace.Id,
            itemId,
            new TransferItemRequest
            {
                DestinationToken = destToken,
                Action = "copy"
            },
            sourceToken);

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var body = await ReadJsonAsync<SpaceItemResponse>(response);
        body.Id.Should().NotBe(itemId);
        body.SpaceId.Should().Be(destSpace.Id);
        body.MemberId.Should().Be(destMember.Id);
        body.ContentType.Should().Be("file");
        body.FileSize.Should().Be(fileBytes.Length);

        var sourceItemStillExists = await factory.WithDbContextAsync(db =>
            db.SpaceItems.AnyAsync(i => i.Id == itemId && i.SpaceId == sourceSpace.Id));
        sourceItemStillExists.Should().BeTrue();

        var destItem = await factory.WithDbContextAsync(db =>
            db.SpaceItems.SingleAsync(i => i.Id == body.Id && i.SpaceId == destSpace.Id));
        destItem.Should().NotBeNull();
        destItem.FileSize.Should().Be(fileBytes.Length);

        var destFileExists = await factory.FileExistsAsync(destSpace.Id, body.Id);
        destFileExists.Should().BeTrue();
    }

    [Fact]
    public async Task TransferItem_MoveTextItem_CreatesInDestination_DeletedFromSource()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var sourceSpace = await factory.CreateSpaceAsync("Source Space");
        var destSpace = await factory.CreateSpaceAsync("Dest Space");
        var sourceMember = await factory.CreateMemberAsync(sourceSpace.Id, "Alice");
        var destMember = await factory.CreateMemberAsync(destSpace.Id, "Bob");

        var sourceToken = GenerateTestJwt(sourceMember.Id, sourceSpace.Id, sourceMember.DisplayName);
        var destToken = GenerateTestJwt(destMember.Id, destSpace.Id, destMember.DisplayName);

        var itemId = Guid.NewGuid();
        await factory.CreateItemAsync(
            sourceSpace.Id,
            sourceMember.Id,
            contentType: "text",
            content: "Moving text",
            sharedAt: DateTime.UtcNow.AddMinutes(-10),
            fileSize: 0,
            itemId: itemId);

        var response = await TransferItemAsync(
            client,
            sourceSpace.Id,
            itemId,
            new TransferItemRequest
            {
                DestinationToken = destToken,
                Action = "move"
            },
            sourceToken);

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var body = await ReadJsonAsync<SpaceItemResponse>(response);
        body.SpaceId.Should().Be(destSpace.Id);
        body.MemberId.Should().Be(destMember.Id);
        body.ContentType.Should().Be("text");
        body.Content.Should().Be("Moving text");

        var sourceItemDeleted = await factory.WithDbContextAsync(db =>
            db.SpaceItems.AnyAsync(i => i.Id == itemId && i.SpaceId == sourceSpace.Id));
        sourceItemDeleted.Should().BeFalse();

        var destItemExists = await factory.WithDbContextAsync(db =>
            db.SpaceItems.AnyAsync(i => i.Id == body.Id && i.SpaceId == destSpace.Id));
        destItemExists.Should().BeTrue();
    }

    [Fact]
    public async Task TransferItem_MoveFileItem_CreatesInDestination_FileMovedAndDeletedFromSource()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var sourceSpace = await factory.CreateSpaceAsync("Source Space");
        var destSpace = await factory.CreateSpaceAsync("Dest Space");
        var sourceMember = await factory.CreateMemberAsync(sourceSpace.Id, "Alice");
        var destMember = await factory.CreateMemberAsync(destSpace.Id, "Bob");

        var sourceToken = GenerateTestJwt(sourceMember.Id, sourceSpace.Id, sourceMember.DisplayName);
        var destToken = GenerateTestJwt(destMember.Id, destSpace.Id, destMember.DisplayName);

        var itemId = Guid.NewGuid();
        var fileBytes = Encoding.UTF8.GetBytes("File to move");
        await factory.CreateFileItemAsync(sourceSpace.Id, sourceMember.Id, itemId, fileBytes, "moving.txt");

        var response = await TransferItemAsync(
            client,
            sourceSpace.Id,
            itemId,
            new TransferItemRequest
            {
                DestinationToken = destToken,
                Action = "move"
            },
            sourceToken);

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var body = await ReadJsonAsync<SpaceItemResponse>(response);
        body.SpaceId.Should().Be(destSpace.Id);
        body.MemberId.Should().Be(destMember.Id);
        body.ContentType.Should().Be("file");
        body.FileSize.Should().Be(fileBytes.Length);

        var sourceItemDeleted = await factory.WithDbContextAsync(db =>
            db.SpaceItems.AnyAsync(i => i.Id == itemId && i.SpaceId == sourceSpace.Id));
        sourceItemDeleted.Should().BeFalse();

        var sourceFileDeleted = await factory.FileExistsAsync(sourceSpace.Id, itemId);
        sourceFileDeleted.Should().BeFalse();

        var destFileExists = await factory.FileExistsAsync(destSpace.Id, body.Id);
        destFileExists.Should().BeTrue();
    }

    [Fact]
    public async Task TransferItem_QuotaExceeded_Returns413()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var sourceSpace = await factory.CreateSpaceAsync("Source Space");
        var destSpace = await factory.CreateSpaceAsync("Dest Space", maxUploadSize: 100);
        var sourceMember = await factory.CreateMemberAsync(sourceSpace.Id, "Alice");
        var destMember = await factory.CreateMemberAsync(destSpace.Id, "Bob");

        var sourceToken = GenerateTestJwt(sourceMember.Id, sourceSpace.Id, sourceMember.DisplayName);
        var destToken = GenerateTestJwt(destMember.Id, destSpace.Id, destMember.DisplayName);

        await factory.CreateItemAsync(
            destSpace.Id,
            destMember.Id,
            contentType: "file",
            content: "existing.bin",
            sharedAt: DateTime.UtcNow.AddMinutes(-10),
            fileSize: 80);

        var itemId = Guid.NewGuid();
        var fileBytes = new byte[50];
        await factory.CreateFileItemAsync(sourceSpace.Id, sourceMember.Id, itemId, fileBytes, "large.bin");

        var response = await TransferItemAsync(
            client,
            sourceSpace.Id,
            itemId,
            new TransferItemRequest
            {
                DestinationToken = destToken,
                Action = "copy"
            },
            sourceToken);

        response.StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge);

        var destItemCount = await factory.WithDbContextAsync(db =>
            db.SpaceItems.CountAsync(i => i.SpaceId == destSpace.Id));
        destItemCount.Should().Be(1);
    }

    [Fact]
    public async Task TransferItem_InvalidDestinationToken_Returns400()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var sourceSpace = await factory.CreateSpaceAsync("Source Space");
        var destSpace = await factory.CreateSpaceAsync("Dest Space");
        var sourceMember = await factory.CreateMemberAsync(sourceSpace.Id, "Alice");
        await factory.CreateMemberAsync(destSpace.Id, "Bob");

        var sourceToken = GenerateTestJwt(sourceMember.Id, sourceSpace.Id, sourceMember.DisplayName);

        var itemId = Guid.NewGuid();
        await factory.CreateItemAsync(
            sourceSpace.Id,
            sourceMember.Id,
            contentType: "text",
            content: "Test",
            sharedAt: DateTime.UtcNow,
            fileSize: 0,
            itemId: itemId);

        var response = await TransferItemAsync(
            client,
            sourceSpace.Id,
            itemId,
            new TransferItemRequest
            {
                DestinationToken = "invalid.malformed.token",
                Action = "copy"
            },
            sourceToken);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var error = await ReadJsonAsync<ErrorResponse>(response);
        error.Error.Should().Contain("Invalid destination token");
    }

    [Fact]
    public async Task TransferItem_RevokedDestinationMember_Returns400()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var sourceSpace = await factory.CreateSpaceAsync("Source Space");
        var destSpace = await factory.CreateSpaceAsync("Dest Space");
        var sourceMember = await factory.CreateMemberAsync(sourceSpace.Id, "Alice");
        var destMember = await factory.CreateMemberAsync(destSpace.Id, "Bob");

        var sourceToken = GenerateTestJwt(sourceMember.Id, sourceSpace.Id, sourceMember.DisplayName);
        var destToken = GenerateTestJwt(destMember.Id, destSpace.Id, destMember.DisplayName);

        await factory.RevokeMemberAsync(destMember.Id);

        var itemId = Guid.NewGuid();
        await factory.CreateItemAsync(
            sourceSpace.Id,
            sourceMember.Id,
            contentType: "text",
            content: "Test",
            sharedAt: DateTime.UtcNow,
            fileSize: 0,
            itemId: itemId);

        var response = await TransferItemAsync(
            client,
            sourceSpace.Id,
            itemId,
            new TransferItemRequest
            {
                DestinationToken = destToken,
                Action = "copy"
            },
            sourceToken);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var error = await ReadJsonAsync<ErrorResponse>(response);
        error.Error.Should().Contain("revoked");
    }

    [Fact]
    public async Task TransferItem_ItemNotFound_Returns404()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var sourceSpace = await factory.CreateSpaceAsync("Source Space");
        var destSpace = await factory.CreateSpaceAsync("Dest Space");
        var sourceMember = await factory.CreateMemberAsync(sourceSpace.Id, "Alice");
        var destMember = await factory.CreateMemberAsync(destSpace.Id, "Bob");

        var sourceToken = GenerateTestJwt(sourceMember.Id, sourceSpace.Id, sourceMember.DisplayName);
        var destToken = GenerateTestJwt(destMember.Id, destSpace.Id, destMember.DisplayName);

        var nonExistentItemId = Guid.NewGuid();

        var response = await TransferItemAsync(
            client,
            sourceSpace.Id,
            nonExistentItemId,
            new TransferItemRequest
            {
                DestinationToken = destToken,
                Action = "copy"
            },
            sourceToken);

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task TransferItem_SameSpaceRejection_Returns400()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync("Same Space");
        var member = await factory.CreateMemberAsync(space.Id, "Alice");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var itemId = Guid.NewGuid();
        await factory.CreateItemAsync(
            space.Id,
            member.Id,
            contentType: "text",
            content: "Test",
            sharedAt: DateTime.UtcNow,
            fileSize: 0,
            itemId: itemId);

        var response = await TransferItemAsync(
            client,
            space.Id,
            itemId,
            new TransferItemRequest
            {
                DestinationToken = token,
                Action = "copy"
            },
            token);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var error = await ReadJsonAsync<ErrorResponse>(response);
        error.Error.Should().Contain("same space");
    }

    [Fact]
    public async Task TransferItem_SpaceIdMismatch_Returns400()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var sourceSpace = await factory.CreateSpaceAsync("Source Space");
        var destSpace = await factory.CreateSpaceAsync("Dest Space");
        var otherSpace = await factory.CreateSpaceAsync("Other Space");
        var sourceMember = await factory.CreateMemberAsync(sourceSpace.Id, "Alice");
        var destMember = await factory.CreateMemberAsync(destSpace.Id, "Bob");

        var sourceToken = GenerateTestJwt(sourceMember.Id, sourceSpace.Id, sourceMember.DisplayName);
        // Token claims otherSpace but member belongs to destSpace — space mismatch
        var mismatchedToken = GenerateTestJwt(destMember.Id, otherSpace.Id, destMember.DisplayName);

        var itemId = Guid.NewGuid();
        await factory.CreateItemAsync(
            sourceSpace.Id,
            sourceMember.Id,
            contentType: "text",
            content: "Test",
            sharedAt: DateTime.UtcNow,
            fileSize: 0,
            itemId: itemId);

        var response = await TransferItemAsync(
            client,
            sourceSpace.Id,
            itemId,
            new TransferItemRequest
            {
                DestinationToken = mismatchedToken,
                Action = "copy"
            },
            sourceToken);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var error = await ReadJsonAsync<ErrorResponse>(response);
        error.Error.Should().Contain("space");
    }

    [Fact]
    public async Task TransferItem_InvalidAction_Returns400()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var sourceSpace = await factory.CreateSpaceAsync("Source Space");
        var destSpace = await factory.CreateSpaceAsync("Dest Space");
        var sourceMember = await factory.CreateMemberAsync(sourceSpace.Id, "Alice");
        var destMember = await factory.CreateMemberAsync(destSpace.Id, "Bob");

        var sourceToken = GenerateTestJwt(sourceMember.Id, sourceSpace.Id, sourceMember.DisplayName);
        var destToken = GenerateTestJwt(destMember.Id, destSpace.Id, destMember.DisplayName);

        var itemId = Guid.NewGuid();
        await factory.CreateItemAsync(
            sourceSpace.Id,
            sourceMember.Id,
            contentType: "text",
            content: "Test",
            sharedAt: DateTime.UtcNow,
            fileSize: 0,
            itemId: itemId);

        var response = await TransferItemAsync(
            client,
            sourceSpace.Id,
            itemId,
            new TransferItemRequest
            {
                DestinationToken = destToken,
                Action = "invalid-action"
            },
            sourceToken);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var error = await ReadJsonAsync<ErrorResponse>(response);
        error.Error.Should().Contain("Action must be either 'copy' or 'move'");
    }


    private static string GenerateTestJwt(Guid memberId, Guid spaceId, string displayName = "TestUser")
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(TestWebApplicationFactory.JwtSigningKey));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(
            claims:
            [
                new Claim(JwtRegisteredClaimNames.Sub, memberId.ToString()),
                new Claim("display_name", displayName),
                new Claim("server_url", TestWebApplicationFactory.ServerUrl),
                new Claim("space_id", spaceId.ToString())
            ],
            signingCredentials: credentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    private static async Task<HttpResponseMessage> TransferItemAsync(
        HttpClient client,
        Guid sourceSpaceId,
        Guid itemId,
        TransferItemRequest request,
        string? token = null)
    {
        using var httpRequest = new HttpRequestMessage(
            HttpMethod.Post,
            $"/v1/spaces/{sourceSpaceId}/items/{itemId}/transfer");

        httpRequest.Content = JsonContent.Create(request);
        AddAuthorizationHeader(httpRequest, token);
        return await client.SendAsync(httpRequest);
    }

    private static void AddAuthorizationHeader(HttpRequestMessage request, string? token)
    {
        if (!string.IsNullOrWhiteSpace(token))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }
    }

    private static async Task<T> ReadJsonAsync<T>(HttpResponseMessage response)
    {
        var body = await response.Content.ReadFromJsonAsync<T>();
        body.Should().NotBeNull();
        return body!;
    }

    private sealed record SpaceItemResponse(
        Guid Id,
        Guid SpaceId,
        Guid MemberId,
        string ContentType,
        string Content,
        long FileSize,
        DateTime SharedAt);

    private sealed record TransferItemRequest
    {
        public string DestinationToken { get; init; } = string.Empty;
        public string Action { get; init; } = string.Empty;
    }

    private sealed record ErrorResponse(string Error);

    private sealed class TestWebApplicationFactory(long? maxSpaceQuotaBytes = null) : WebApplicationFactory<Program>
    {
        public const string AdminSecret = "test-admin-secret";
        public const string JwtSigningKey = "test-signing-key-1234567890abcdef";
        public const string ServerUrl = "https://sharedspaces.test";

        private readonly string _databaseName = $"sharedspaces-transfer-tests-{Guid.NewGuid()}";
        private readonly long _maxSpaceQuotaBytes = maxSpaceQuotaBytes ?? 104_857_600;
        private const string StorageBasePath = "./artifacts/storage-tests";

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");

            builder.ConfigureAppConfiguration((_, configBuilder) =>
            {
                configBuilder.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Admin:Secret"] = AdminSecret,
                    ["Jwt:SigningKey"] = JwtSigningKey,
                    ["Storage:BasePath"] = StorageBasePath,
                    ["Storage:MaxSpaceQuotaBytes"] = _maxSpaceQuotaBytes.ToString()
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

        public async Task<SpaceMember> CreateMemberAsync(Guid spaceId, string displayName = "TestUser", Guid? memberId = null)
        {
            return await WithDbContextAsync(async db =>
            {
                var member = new SpaceMember
                {
                    Id = memberId ?? Guid.NewGuid(),
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

        public async Task RevokeMemberAsync(Guid memberId)
        {
            await WithDbContextAsync(async db =>
            {
                var member = await db.SpaceMembers.SingleAsync(m => m.Id == memberId);
                member.IsRevoked = true;
                await db.SaveChangesAsync();
            });
        }

        public async Task<SpaceItem> CreateItemAsync(
            Guid spaceId,
            Guid memberId,
            string contentType,
            string content,
            DateTime sharedAt,
            long fileSize,
            Guid? itemId = null)
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
            Guid spaceId,
            Guid memberId,
            Guid itemId,
            byte[] fileBytes,
            string fileName)
        {
            var item = await CreateItemAsync(
                spaceId,
                memberId,
                contentType: "file",
                content: fileName,
                sharedAt: DateTime.UtcNow,
                fileSize: fileBytes.Length,
                itemId: itemId);

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
                ArgumentNullException.ThrowIfNull(content);

                await using var buffer = new MemoryStream();
                await content.CopyToAsync(buffer, ct);
                var key = GetKey(spaceId, itemId);

                lock (_syncRoot)
                {
                    _files[key] = buffer.ToArray();
                }
            }

            public Task<Stream> ReadAsync(Guid spaceId, Guid itemId, CancellationToken ct)
            {
                ct.ThrowIfCancellationRequested();
                var key = GetKey(spaceId, itemId);

                lock (_syncRoot)
                {
                    if (!_files.TryGetValue(key, out var bytes))
                    {
                        throw new FileNotFoundException($"Stored file '{key}' was not found.", key);
                    }

                    return Task.FromResult<Stream>(new MemoryStream(bytes));
                }
            }

            public Task DeleteAsync(Guid spaceId, Guid itemId, CancellationToken ct)
            {
                ct.ThrowIfCancellationRequested();
                var key = GetKey(spaceId, itemId);

                lock (_syncRoot)
                {
                    _files.Remove(key);
                }

                return Task.CompletedTask;
            }
        }
    }
}
