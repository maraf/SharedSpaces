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

public class SharedLinkEndpointTests
{
    // ──────────────────────────────────────────────
    // Authenticated: Create shared link
    // ──────────────────────────────────────────────

    [Fact]
    public async Task CreateSharedLink_ForTextItem_Returns201WithLinkDetails()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync("Link Space");
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var item = await factory.CreateItemAsync(
            space.Id, member.Id,
            contentType: "text", content: "Hello shared world",
            sharedAt: DateTime.UtcNow.AddMinutes(-5), fileSize: 0);

        var beforeRequest = DateTimeOffset.UtcNow;

        var response = await CreateSharedLinkAsync(client, space.Id, item.Id, token);

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var body = await ReadJsonAsync<SharedLinkResponse>(response);
        body.Id.Should().NotBe(Guid.Empty);
        body.Token.Should().NotBe(Guid.Empty);
        body.SpaceId.Should().Be(space.Id);
        body.ItemId.Should().Be(item.Id);
        body.CreatedBy.Should().Be(member.Id);
        body.CreatedAt.Should().BeOnOrAfter(beforeRequest.AddSeconds(-2));
    }

    [Fact]
    public async Task CreateSharedLink_ForFileItem_Returns201()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var itemId = Guid.NewGuid();
        var fileBytes = Encoding.UTF8.GetBytes("Binary file content");
        await factory.CreateFileItemAsync(space.Id, member.Id, itemId, fileBytes, "document.pdf");

        var response = await CreateSharedLinkAsync(client, space.Id, itemId, token);

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var body = await ReadJsonAsync<SharedLinkResponse>(response);
        body.ItemId.Should().Be(itemId);
        body.SpaceId.Should().Be(space.Id);
        body.CreatedBy.Should().Be(member.Id);
    }

    [Fact]
    public async Task CreateSharedLink_WithoutJwt_Returns401()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var item = await factory.CreateItemAsync(
            space.Id, member.Id,
            contentType: "text", content: "hello",
            sharedAt: DateTime.UtcNow, fileSize: 0);

        var response = await CreateSharedLinkAsync(client, space.Id, item.Id);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task CreateSharedLink_WrongSpaceMember_ReturnsForbidden()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var targetSpace = await factory.CreateSpaceAsync("Target Space");
        var otherSpace = await factory.CreateSpaceAsync("Other Space");
        var otherMember = await factory.CreateMemberAsync(otherSpace.Id, "Outsider");
        var targetMember = await factory.CreateMemberAsync(targetSpace.Id, "Insider");
        var wrongToken = GenerateTestJwt(otherMember.Id, otherSpace.Id, otherMember.DisplayName);

        var item = await factory.CreateItemAsync(
            targetSpace.Id, targetMember.Id,
            contentType: "text", content: "secret",
            sharedAt: DateTime.UtcNow, fileSize: 0);

        var response = await CreateSharedLinkAsync(client, targetSpace.Id, item.Id, wrongToken);

        response.StatusCode.Should().BeOneOf(HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task CreateSharedLink_NonExistentItem_Returns404()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var response = await CreateSharedLinkAsync(client, space.Id, Guid.NewGuid(), token);

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    // ──────────────────────────────────────────────
    // Authenticated: List shared links
    // ──────────────────────────────────────────────

    [Fact]
    public async Task ListSharedLinks_ReturnsAllLinksForItem()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var item = await factory.CreateItemAsync(
            space.Id, member.Id,
            contentType: "text", content: "shared item",
            sharedAt: DateTime.UtcNow, fileSize: 0);

        // Create two links
        var create1 = await CreateSharedLinkAsync(client, space.Id, item.Id, token);
        create1.StatusCode.Should().Be(HttpStatusCode.Created);
        var create2 = await CreateSharedLinkAsync(client, space.Id, item.Id, token);
        create2.StatusCode.Should().Be(HttpStatusCode.Created);

        var response = await ListSharedLinksAsync(client, space.Id, item.Id, token);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var links = await ReadJsonAsync<List<SharedLinkResponse>>(response);
        links.Should().HaveCount(2);
        links.Should().OnlyContain(link => link.ItemId == item.Id);
        links.Should().OnlyContain(link => link.SpaceId == space.Id);
        // Tokens should be unique
        links.Select(l => l.Token).Distinct().Should().HaveCount(2);
    }

    [Fact]
    public async Task ListSharedLinks_ReturnsEmptyArrayWhenNoneExist()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var item = await factory.CreateItemAsync(
            space.Id, member.Id,
            contentType: "text", content: "no links",
            sharedAt: DateTime.UtcNow, fileSize: 0);

        var response = await ListSharedLinksAsync(client, space.Id, item.Id, token);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var links = await ReadJsonAsync<List<SharedLinkResponse>>(response);
        links.Should().BeEmpty();
    }

    // ──────────────────────────────────────────────
    // Authenticated: Delete shared link
    // ──────────────────────────────────────────────

    [Fact]
    public async Task DeleteSharedLink_CreatorDeletes_Returns204()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var item = await factory.CreateItemAsync(
            space.Id, member.Id,
            contentType: "text", content: "deletable",
            sharedAt: DateTime.UtcNow, fileSize: 0);

        var createResponse = await CreateSharedLinkAsync(client, space.Id, item.Id, token);
        var link = await ReadJsonAsync<SharedLinkResponse>(createResponse);

        var deleteResponse = await DeleteSharedLinkAsync(client, space.Id, item.Id, link.Id, token);

        deleteResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        // Verify deleted from DB
        var exists = await factory.WithDbContextAsync(db =>
            db.SharedLinks.AnyAsync(l => l.Id == link.Id));
        exists.Should().BeFalse();
    }

    [Fact]
    public async Task DeleteSharedLink_AnyMemberCanDelete_Returns204()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var creator = await factory.CreateMemberAsync(space.Id, "Creator");
        var otherMember = await factory.CreateMemberAsync(space.Id, "OtherMember");
        var creatorToken = GenerateTestJwt(creator.Id, space.Id, creator.DisplayName);
        var otherToken = GenerateTestJwt(otherMember.Id, space.Id, otherMember.DisplayName);

        var item = await factory.CreateItemAsync(
            space.Id, creator.Id,
            contentType: "text", content: "shared",
            sharedAt: DateTime.UtcNow, fileSize: 0);

        // Creator creates the link
        var createResponse = await CreateSharedLinkAsync(client, space.Id, item.Id, creatorToken);
        var link = await ReadJsonAsync<SharedLinkResponse>(createResponse);

        // Other member deletes it
        var deleteResponse = await DeleteSharedLinkAsync(client, space.Id, item.Id, link.Id, otherToken);

        deleteResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);
    }

    [Fact]
    public async Task DeleteSharedLink_NonExistentLink_Returns404()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var item = await factory.CreateItemAsync(
            space.Id, member.Id,
            contentType: "text", content: "hello",
            sharedAt: DateTime.UtcNow, fileSize: 0);

        var response = await DeleteSharedLinkAsync(client, space.Id, item.Id, Guid.NewGuid(), token);

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    // ──────────────────────────────────────────────
    // Unauthenticated: Get shared item
    // ──────────────────────────────────────────────

    [Fact]
    public async Task GetSharedItem_TextItem_ReturnsMetadataWithoutAuth()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var item = await factory.CreateItemAsync(
            space.Id, member.Id,
            contentType: "text", content: "Public text content",
            sharedAt: DateTime.UtcNow.AddMinutes(-10), fileSize: 0);

        var createResponse = await CreateSharedLinkAsync(client, space.Id, item.Id, token);
        var link = await ReadJsonAsync<SharedLinkResponse>(createResponse);

        // No auth header — public endpoint
        var response = await GetSharedItemAsync(client, link.Token);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await ReadJsonAsync<SharedItemResponse>(response);
        body.ContentType.Should().Be("text");
        body.Content.Should().Be("Public text content");
        body.FileSize.Should().Be(0);
    }

    [Fact]
    public async Task GetSharedItem_FileItem_ReturnsFileMetadata()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var authToken = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var itemId = Guid.NewGuid();
        var fileBytes = Encoding.UTF8.GetBytes("File binary data");
        await factory.CreateFileItemAsync(space.Id, member.Id, itemId, fileBytes, "report.pdf");

        var createResponse = await CreateSharedLinkAsync(client, space.Id, itemId, authToken);
        var link = await ReadJsonAsync<SharedLinkResponse>(createResponse);

        var response = await GetSharedItemAsync(client, link.Token);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await ReadJsonAsync<SharedItemResponse>(response);
        body.ContentType.Should().Be("file");
        body.Content.Should().Be("report.pdf");
        body.FileSize.Should().Be(fileBytes.Length);
    }

    [Fact]
    public async Task GetSharedItem_NonExistentToken_Returns404()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var response = await GetSharedItemAsync(client, Guid.NewGuid());

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task GetSharedItem_DeletedLink_Returns404()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var authToken = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var item = await factory.CreateItemAsync(
            space.Id, member.Id,
            contentType: "text", content: "ephemeral",
            sharedAt: DateTime.UtcNow, fileSize: 0);

        var createResponse = await CreateSharedLinkAsync(client, space.Id, item.Id, authToken);
        var link = await ReadJsonAsync<SharedLinkResponse>(createResponse);

        // Delete the link
        var deleteResponse = await DeleteSharedLinkAsync(client, space.Id, item.Id, link.Id, authToken);
        deleteResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        // Try to access it — should be gone
        var response = await GetSharedItemAsync(client, link.Token);

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    // ──────────────────────────────────────────────
    // Unauthenticated: Download shared file
    // ──────────────────────────────────────────────

    [Fact]
    public async Task DownloadSharedFile_HappyPath_ReturnsFileContent()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var authToken = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var itemId = Guid.NewGuid();
        var fileBytes = Encoding.UTF8.GetBytes("Downloadable file content");
        await factory.CreateFileItemAsync(space.Id, member.Id, itemId, fileBytes, "download.txt");

        var createResponse = await CreateSharedLinkAsync(client, space.Id, itemId, authToken);
        var link = await ReadJsonAsync<SharedLinkResponse>(createResponse);

        // No auth header — public download
        var response = await DownloadSharedFileAsync(client, link.Token);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.Content.Headers.ContentType?.MediaType.Should().Be("application/octet-stream");
        var downloadedBytes = await response.Content.ReadAsByteArrayAsync();
        downloadedBytes.Should().BeEquivalentTo(fileBytes);
    }

    [Fact]
    public async Task DownloadSharedFile_TextItem_Returns404()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var authToken = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var item = await factory.CreateItemAsync(
            space.Id, member.Id,
            contentType: "text", content: "Not a file",
            sharedAt: DateTime.UtcNow, fileSize: 0);

        var createResponse = await CreateSharedLinkAsync(client, space.Id, item.Id, authToken);
        var link = await ReadJsonAsync<SharedLinkResponse>(createResponse);

        var response = await DownloadSharedFileAsync(client, link.Token);

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task DownloadSharedFile_NonExistentToken_Returns404()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var response = await DownloadSharedFileAsync(client, Guid.NewGuid());

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    // ──────────────────────────────────────────────
    // Edge cases: Multiple links
    // ──────────────────────────────────────────────

    [Fact]
    public async Task MultipleLinksForSameItem_AllWorkIndependently()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var authToken = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var item = await factory.CreateItemAsync(
            space.Id, member.Id,
            contentType: "text", content: "Multi-linked item",
            sharedAt: DateTime.UtcNow, fileSize: 0);

        var create1 = await CreateSharedLinkAsync(client, space.Id, item.Id, authToken);
        var link1 = await ReadJsonAsync<SharedLinkResponse>(create1);
        var create2 = await CreateSharedLinkAsync(client, space.Id, item.Id, authToken);
        var link2 = await ReadJsonAsync<SharedLinkResponse>(create2);

        link1.Token.Should().NotBe(link2.Token);

        // Both tokens should resolve the same item
        var response1 = await GetSharedItemAsync(client, link1.Token);
        var response2 = await GetSharedItemAsync(client, link2.Token);

        response1.StatusCode.Should().Be(HttpStatusCode.OK);
        response2.StatusCode.Should().Be(HttpStatusCode.OK);

        var item1 = await ReadJsonAsync<SharedItemResponse>(response1);
        var item2 = await ReadJsonAsync<SharedItemResponse>(response2);

        item1.Content.Should().Be("Multi-linked item");
        item2.Content.Should().Be("Multi-linked item");
    }

    [Fact]
    public async Task DeleteOneLink_DoesNotAffectOtherLinksToSameItem()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var authToken = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var item = await factory.CreateItemAsync(
            space.Id, member.Id,
            contentType: "text", content: "Partially shared",
            sharedAt: DateTime.UtcNow, fileSize: 0);

        var create1 = await CreateSharedLinkAsync(client, space.Id, item.Id, authToken);
        var link1 = await ReadJsonAsync<SharedLinkResponse>(create1);
        var create2 = await CreateSharedLinkAsync(client, space.Id, item.Id, authToken);
        var link2 = await ReadJsonAsync<SharedLinkResponse>(create2);

        // Delete link1
        var deleteResponse = await DeleteSharedLinkAsync(client, space.Id, item.Id, link1.Id, authToken);
        deleteResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        // link1 should be gone
        var gone = await GetSharedItemAsync(client, link1.Token);
        gone.StatusCode.Should().Be(HttpStatusCode.NotFound);

        // link2 should still work
        var stillAlive = await GetSharedItemAsync(client, link2.Token);
        stillAlive.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await ReadJsonAsync<SharedItemResponse>(stillAlive);
        body.Content.Should().Be("Partially shared");
    }

    // ──────────────────────────────────────────────
    // HTTP helpers
    // ──────────────────────────────────────────────

    private static async Task<HttpResponseMessage> CreateSharedLinkAsync(
        HttpClient client, Guid spaceId, Guid itemId, string? token = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post,
            $"/v1/spaces/{spaceId}/items/{itemId}/share");
        AddAuthorizationHeader(request, token);
        return await client.SendAsync(request);
    }

    private static async Task<HttpResponseMessage> ListSharedLinksAsync(
        HttpClient client, Guid spaceId, Guid itemId, string? token = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get,
            $"/v1/spaces/{spaceId}/items/{itemId}/share");
        AddAuthorizationHeader(request, token);
        return await client.SendAsync(request);
    }

    private static async Task<HttpResponseMessage> DeleteSharedLinkAsync(
        HttpClient client, Guid spaceId, Guid itemId, Guid linkId, string? token = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Delete,
            $"/v1/spaces/{spaceId}/items/{itemId}/share/{linkId}");
        AddAuthorizationHeader(request, token);
        return await client.SendAsync(request);
    }

    private static async Task<HttpResponseMessage> GetSharedItemAsync(HttpClient client, Guid linkToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"/v1/shared/{linkToken}");
        return await client.SendAsync(request);
    }

    private static async Task<HttpResponseMessage> DownloadSharedFileAsync(HttpClient client, Guid linkToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"/v1/shared/{linkToken}/download");
        return await client.SendAsync(request);
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

    private static string GenerateTestJwt(Guid memberId, Guid spaceId, string displayName = "TestUser")
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(TestWebApplicationFactory.JwtSigningKey));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var jwtToken = new JwtSecurityToken(
            claims:
            [
                new Claim(JwtRegisteredClaimNames.Sub, memberId.ToString()),
                new Claim("display_name", displayName),
                new Claim("server_url", TestWebApplicationFactory.ServerUrl),
                new Claim("space_id", spaceId.ToString())
            ],
            signingCredentials: credentials);

        return new JwtSecurityTokenHandler().WriteToken(jwtToken);
    }

    // ──────────────────────────────────────────────
    // Response records
    // ──────────────────────────────────────────────

    private sealed record SharedLinkResponse(
        Guid Id,
        Guid Token,
        Guid SpaceId,
        Guid ItemId,
        Guid CreatedBy,
        DateTimeOffset CreatedAt);

    private sealed record SharedItemResponse(
        string ContentType,
        string Content,
        long FileSize,
        DateTimeOffset SharedAt);

    // ──────────────────────────────────────────────
    // Test infrastructure
    // ──────────────────────────────────────────────

    private sealed class TestWebApplicationFactory : WebApplicationFactory<Program>
    {
        public const string AdminSecret = "test-admin-secret";
        public const string JwtSigningKey = "test-signing-key-1234567890abcdef";
        public const string ServerUrl = "https://sharedspaces.test";

        private readonly string _databaseName = $"sharedspaces-sharedlink-tests-{Guid.NewGuid()}";

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");

            builder.ConfigureAppConfiguration((_, configBuilder) =>
            {
                configBuilder.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Admin:Secret"] = AdminSecret,
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
            });
        }

        public async Task<Space> CreateSpaceAsync(string name = "Test Space")
        {
            return await WithDbContextAsync(async db =>
            {
                var space = new Space
                {
                    Id = Guid.NewGuid(),
                    Name = name
                };

                db.Spaces.Add(space);
                await db.SaveChangesAsync();
                return space;
            });
        }

        public async Task<SpaceMember> CreateMemberAsync(Guid spaceId, string displayName = "TestUser")
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
                spaceId, memberId,
                contentType: "file", content: fileName,
                sharedAt: DateTime.UtcNow, fileSize: fileBytes.Length,
                itemId: itemId);

            using var scope = Services.CreateScope();
            var fileStorage = scope.ServiceProvider.GetRequiredService<IFileStorage>();
            await using var stream = new MemoryStream(fileBytes);
            await fileStorage.SaveAsync(spaceId, itemId, stream, CancellationToken.None);

            return item;
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

                    return Task.FromResult<Stream>(new MemoryStream(bytes, writable: false));
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
