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

public class ItemEndpointTests
{
    [Fact]
    public async Task GetSpaceInfo_ReturnsSpaceInfoForAuthenticatedMember()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync("Launch Room");
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var response = await GetSpaceAsync(client, space.Id, token);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await ReadJsonAsync<SpaceInfoResponse>(response);
        body.Id.Should().Be(space.Id);
        body.Name.Should().Be(space.Name);
        body.CreatedAt.Should().BeCloseTo(space.CreatedAt, TimeSpan.FromSeconds(1));
    }

    [Fact]
    public async Task GetSpaceInfo_WithoutJwt_Returns401()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();

        var response = await GetSpaceAsync(client, space.Id);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetSpaceInfo_WithMismatchedSpaceClaim_ReturnsUnauthorizedOrForbidden()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var requestedSpace = await factory.CreateSpaceAsync("Requested Space");
        var memberSpace = await factory.CreateSpaceAsync("Member Space");
        var member = await factory.CreateMemberAsync(memberSpace.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, memberSpace.Id, member.DisplayName);

        var response = await GetSpaceAsync(client, requestedSpace.Id, token);

        response.StatusCode.Should().BeOneOf(HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task ListItems_ReturnsEmptyListForSpaceWithNoItems()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var response = await ListItemsAsync(client, space.Id, token);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var items = await ReadJsonAsync<List<SpaceItemResponse>>(response);
        items.Should().BeEmpty();
    }

    [Fact]
    public async Task ListItems_ReturnsItemsOrderedBySharedAtDescending()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var olderItem = await factory.CreateItemAsync(
            space.Id,
            member.Id,
            contentType: "text",
            content: "older",
            sharedAt: DateTime.UtcNow.AddMinutes(-30),
            fileSize: 0);
        var middleItem = await factory.CreateItemAsync(
            space.Id,
            member.Id,
            contentType: "text",
            content: "middle",
            sharedAt: DateTime.UtcNow.AddMinutes(-20),
            fileSize: 0);
        var newerItem = await factory.CreateItemAsync(
            space.Id,
            member.Id,
            contentType: "text",
            content: "newer",
            sharedAt: DateTime.UtcNow.AddMinutes(-10),
            fileSize: 0);

        var otherSpace = await factory.CreateSpaceAsync("Other Space");
        var otherMember = await factory.CreateMemberAsync(otherSpace.Id, "Alex");
        await factory.CreateItemAsync(
            otherSpace.Id,
            otherMember.Id,
            contentType: "text",
            content: "foreign",
            sharedAt: DateTime.UtcNow,
            fileSize: 0);

        var response = await ListItemsAsync(client, space.Id, token);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var items = await ReadJsonAsync<List<SpaceItemResponse>>(response);
        items.Should().HaveCount(3);
        items.Select(item => item.SpaceId).Should().OnlyContain(returnedSpaceId => returnedSpaceId == space.Id);
        items.Select(item => item.Id).Should().ContainInOrder(newerItem.Id, middleItem.Id, olderItem.Id);
        items.Select(item => item.Content).Should().ContainInOrder("newer", "middle", "older");
    }

    [Fact]
    public async Task ListItems_WithoutJwt_Returns401()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();

        var response = await ListItemsAsync(client, space.Id);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task ListItems_WithMismatchedSpaceClaim_ReturnsUnauthorizedOrForbidden()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var requestedSpace = await factory.CreateSpaceAsync("Requested Space");
        var memberSpace = await factory.CreateSpaceAsync("Member Space");
        var member = await factory.CreateMemberAsync(memberSpace.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, memberSpace.Id, member.DisplayName);

        var response = await ListItemsAsync(client, requestedSpace.Id, token);

        response.StatusCode.Should().BeOneOf(HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task UpsertTextItem_CreatesNewItem_Returns201()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);
        var itemId = Guid.NewGuid();
        var beforeRequest = DateTime.UtcNow;

        var response = await UpsertTextItemAsync(client, space.Id, itemId, "hello world", token);

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var body = await ReadJsonAsync<SpaceItemResponse>(response);
        body.Id.Should().Be(itemId);
        body.SpaceId.Should().Be(space.Id);
        body.MemberId.Should().Be(member.Id);
        body.ContentType.Should().Be("text");
        body.Content.Should().Be("hello world");
        body.FileSize.Should().Be(0);
        body.SharedAt.Should().BeOnOrAfter(beforeRequest.AddSeconds(-1));

        var savedItem = await factory.WithDbContextAsync(db => db.SpaceItems.SingleAsync(item => item.Id == itemId));
        savedItem.SpaceId.Should().Be(space.Id);
        savedItem.MemberId.Should().Be(member.Id);
        savedItem.ContentType.Should().Be("text");
        savedItem.Content.Should().Be("hello world");
        savedItem.FileSize.Should().Be(0);
    }

    [Fact]
    public async Task UpsertTextItem_UpdatesExistingItem_Returns200()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);
        var existingItem = await factory.CreateItemAsync(
            space.Id,
            member.Id,
            contentType: "text",
            content: "before",
            sharedAt: DateTime.UtcNow.AddMinutes(-5),
            fileSize: 0);

        var response = await UpsertTextItemAsync(client, space.Id, existingItem.Id, "after", token);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await ReadJsonAsync<SpaceItemResponse>(response);
        body.Id.Should().Be(existingItem.Id);
        body.SpaceId.Should().Be(space.Id);
        body.MemberId.Should().Be(member.Id);
        body.ContentType.Should().Be("text");
        body.Content.Should().Be("after");
        body.FileSize.Should().Be(0);

        var savedItem = await factory.WithDbContextAsync(db => db.SpaceItems.SingleAsync(item => item.Id == existingItem.Id));
        savedItem.Content.Should().Be("after");
        savedItem.ContentType.Should().Be("text");
        savedItem.FileSize.Should().Be(0);
        var itemCount = await factory.WithDbContextAsync(db => db.SpaceItems.CountAsync(item => item.Id == existingItem.Id));
        itemCount.Should().Be(1);
    }

    [Fact]
    public async Task UpsertTextItem_WithoutJwt_Returns401()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();

        var response = await UpsertTextItemAsync(client, space.Id, Guid.NewGuid(), "hello world");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task UpsertTextItem_WithEmptyGuid_Returns400()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var response = await UpsertTextItemAsync(client, space.Id, Guid.Empty, "hello world", token);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task UpsertTextItem_WithMismatchedSpaceClaim_ReturnsUnauthorizedOrForbidden()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var requestedSpace = await factory.CreateSpaceAsync("Requested Space");
        var memberSpace = await factory.CreateSpaceAsync("Member Space");
        var member = await factory.CreateMemberAsync(memberSpace.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, memberSpace.Id, member.DisplayName);

        var response = await UpsertTextItemAsync(client, requestedSpace.Id, Guid.NewGuid(), "hello world", token);

        response.StatusCode.Should().BeOneOf(HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task UpsertTextItem_WithInvalidContentType_Returns400()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);
        var response = await UpsertTextItemAsync(client, space.Id, Guid.NewGuid(), "hello world", token, contentType: "image");

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task UpsertFileItem_CreatesFileWithinQuota_Returns201()
    {
        await using var factory = new TestWebApplicationFactory(maxSpaceQuotaBytes: 1024);
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);
        var itemId = Guid.NewGuid();
        var fileBytes = Enumerable.Repeat((byte)'a', 256).ToArray();

        var response = await UpsertFileItemAsync(client, space.Id, itemId, fileBytes, "note.txt", token);

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var body = await ReadJsonAsync<SpaceItemResponse>(response);
        body.Id.Should().Be(itemId);
        body.SpaceId.Should().Be(space.Id);
        body.MemberId.Should().Be(member.Id);
        body.ContentType.Should().Be("file");
        body.Content.Should().NotBeNullOrWhiteSpace();
        body.FileSize.Should().Be(fileBytes.LongLength);

        var savedItem = await factory.WithDbContextAsync(db => db.SpaceItems.SingleAsync(item => item.Id == itemId));
        savedItem.SpaceId.Should().Be(space.Id);
        savedItem.MemberId.Should().Be(member.Id);
        savedItem.ContentType.Should().Be("file");
        savedItem.Content.Should().NotBeNullOrWhiteSpace();
        savedItem.FileSize.Should().Be(fileBytes.LongLength);
    }

    [Fact]
    public async Task UpsertFileItem_WhenQuotaWouldBeExceeded_Returns413()
    {
        await using var factory = new TestWebApplicationFactory(maxSpaceQuotaBytes: 1024);
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);
        await factory.CreateItemAsync(
            space.Id,
            member.Id,
            contentType: "file",
            content: "existing.bin",
            sharedAt: DateTime.UtcNow.AddMinutes(-1),
            fileSize: 900);

        var response = await UpsertFileItemAsync(
            client,
            space.Id,
            Guid.NewGuid(),
            Enumerable.Repeat((byte)'b', 200).ToArray(),
            "too-large.bin",
            token);

        response.StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge);
        var itemCount = await factory.WithDbContextAsync(db => db.SpaceItems.CountAsync(item => item.SpaceId == space.Id));
        itemCount.Should().Be(1);
    }

    // ========== Per-Space Upload Quota Tests ==========

    [Fact]
    public async Task UpsertFileItem_WithinPerSpaceQuota_Succeeds()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync("Small Quota Space", maxUploadSize: 1024);
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);
        var itemId = Guid.NewGuid();
        var fileBytes = Enumerable.Repeat((byte)'a', 256).ToArray();

        var response = await UpsertFileItemAsync(client, space.Id, itemId, fileBytes, "small.txt", token);

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var body = await ReadJsonAsync<SpaceItemResponse>(response);
        body.Id.Should().Be(itemId);
        body.FileSize.Should().Be(fileBytes.LongLength);
    }

    [Fact]
    public async Task UpsertFileItem_ExceedingPerSpaceQuota_Returns413()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync("Tight Quota Space", maxUploadSize: 1024);
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);
        await factory.CreateItemAsync(
            space.Id,
            member.Id,
            contentType: "file",
            content: "existing.bin",
            sharedAt: DateTime.UtcNow.AddMinutes(-1),
            fileSize: 900);

        var response = await UpsertFileItemAsync(
            client,
            space.Id,
            Guid.NewGuid(),
            Enumerable.Repeat((byte)'x', 200).ToArray(),
            "overflow.bin",
            token);

        response.StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge);
        var itemCount = await factory.WithDbContextAsync(db => db.SpaceItems.CountAsync(item => item.SpaceId == space.Id));
        itemCount.Should().Be(1);
    }

    [Fact]
    public async Task UpsertFileItem_WithoutPerSpaceQuota_UsesServerDefault()
    {
        await using var factory = new TestWebApplicationFactory(maxSpaceQuotaBytes: 1024);
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var response = await UpsertFileItemAsync(
            client,
            space.Id,
            Guid.NewGuid(),
            Enumerable.Repeat((byte)'z', 2000).ToArray(),
            "too-large.bin",
            token);

        response.StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge);
    }

    [Fact]
    public async Task DeleteItem_DeletesExistingItem_Returns204()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);
        var item = await factory.CreateItemAsync(
            space.Id,
            member.Id,
            contentType: "text",
            content: "to delete",
            sharedAt: DateTime.UtcNow,
            fileSize: 0);

        var response = await DeleteItemAsync(client, space.Id, item.Id, token);

        response.StatusCode.Should().Be(HttpStatusCode.NoContent);
        var exists = await factory.WithDbContextAsync(db => db.SpaceItems.AnyAsync(existingItem => existingItem.Id == item.Id));
        exists.Should().BeFalse();
    }

    [Fact]
    public async Task DeleteItem_NonExistent_Returns404()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var response = await DeleteItemAsync(client, space.Id, Guid.NewGuid(), token);

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task DeleteItem_WithoutJwt_Returns401()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();

        var response = await DeleteItemAsync(client, space.Id, Guid.NewGuid());

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task DeleteItem_WithMismatchedSpaceClaim_ReturnsUnauthorizedOrForbidden()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var requestedSpace = await factory.CreateSpaceAsync("Requested Space");
        var memberSpace = await factory.CreateSpaceAsync("Member Space");
        var member = await factory.CreateMemberAsync(memberSpace.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, memberSpace.Id, member.DisplayName);

        var response = await DeleteItemAsync(client, requestedSpace.Id, Guid.NewGuid(), token);

        response.StatusCode.Should().BeOneOf(HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden);
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

    private static async Task<HttpResponseMessage> GetSpaceAsync(HttpClient client, Guid spaceId, string? token = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"/v1/spaces/{spaceId}");
        AddAuthorizationHeader(request, token);
        return await client.SendAsync(request);
    }

    private static async Task<HttpResponseMessage> ListItemsAsync(HttpClient client, Guid spaceId, string? token = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"/v1/spaces/{spaceId}/items");
        AddAuthorizationHeader(request, token);
        return await client.SendAsync(request);
    }

    private static async Task<HttpResponseMessage> UpsertTextItemAsync(
        HttpClient client,
        Guid spaceId,
        Guid itemId,
        string content,
        string? token = null,
        string contentType = "text")
    {
        using var request = new HttpRequestMessage(HttpMethod.Put, $"/v1/spaces/{spaceId}/items/{itemId}");
        using var form = new MultipartFormDataContent();
        form.Add(new StringContent(itemId.ToString()), "id");
        form.Add(new StringContent(contentType), "contentType");
        form.Add(new StringContent(content), "content");
        request.Content = form;

        AddAuthorizationHeader(request, token);
        return await client.SendAsync(request);
    }

    private static async Task<HttpResponseMessage> UpsertFileItemAsync(
        HttpClient client,
        Guid spaceId,
        Guid itemId,
        byte[] fileBytes,
        string fileName,
        string? token = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Put, $"/v1/spaces/{spaceId}/items/{itemId}");
        using var form = new MultipartFormDataContent();
        using var fileContent = new StreamContent(new MemoryStream(fileBytes));
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");

        form.Add(new StringContent(itemId.ToString()), "id");
        form.Add(new StringContent("file"), "contentType");
        form.Add(fileContent, "file", fileName);
        request.Content = form;

        AddAuthorizationHeader(request, token);
        return await client.SendAsync(request);
    }

    private static async Task<HttpResponseMessage> DeleteItemAsync(HttpClient client, Guid spaceId, Guid itemId, string? token = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Delete, $"/v1/spaces/{spaceId}/items/{itemId}");
        AddAuthorizationHeader(request, token);
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

    private sealed record SpaceInfoResponse(Guid Id, string Name, DateTime CreatedAt);

    private sealed record SpaceItemResponse(
        Guid Id,
        Guid SpaceId,
        Guid MemberId,
        string ContentType,
        string Content,
        long FileSize,
        DateTime SharedAt);

    private sealed class TestWebApplicationFactory(long? maxSpaceQuotaBytes = null) : WebApplicationFactory<Program>
    {
        public const string AdminSecret = "test-admin-secret";
        public const string JwtSigningKey = "test-signing-key-1234567890abcdef";
        public const string ServerUrl = "https://sharedspaces.test";

        private readonly string _databaseName = $"sharedspaces-items-tests-{Guid.NewGuid()}";
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

                    Stream stream = new MemoryStream(bytes, writable: false);
                    return Task.FromResult(stream);
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
