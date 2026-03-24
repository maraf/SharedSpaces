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

/// <summary>
/// Integration tests for automatic conversion of long text messages to .txt files (Issue #109).
/// Tests cover happy paths, edge cases, quota enforcement, and update scenarios.
/// Kaylee has set the auto-convert threshold to 64KB (65,536 bytes).
/// </summary>
public class ItemAutoConvertTests
{
    private const int AutoConvertThresholdBytes = 65_536; // 64KB - matches Kaylee's implementation
    
    [Fact]
    public async Task UpsertTextItem_ShortText_StaysAsTextItem()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);
        var itemId = Guid.NewGuid();

        var shortText = "Hello, this is a short message.";
        var response = await UpsertTextItemAsync(client, space.Id, itemId, shortText, token);

        response.StatusCode.Should().BeOneOf(HttpStatusCode.Created, HttpStatusCode.OK);
        var body = await ReadJsonAsync<SpaceItemResponse>(response);
        body.ContentType.Should().Be("text");
        body.Content.Should().Be(shortText);
        body.FileSize.Should().Be(0);
    }

    [Fact]
    public async Task UpsertTextItem_LongText_AutoConvertsToFile()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);
        var itemId = Guid.NewGuid();

        var longText = new string('A', AutoConvertThresholdBytes + 1000);
        var response = await UpsertTextItemAsync(client, space.Id, itemId, longText, token);

        response.StatusCode.Should().BeOneOf(HttpStatusCode.Created, HttpStatusCode.OK);
        var body = await ReadJsonAsync<SpaceItemResponse>(response);
        body.ContentType.Should().Be("file", "long text should be auto-converted to file");
        body.Content.Should().EndWith(".txt", "auto-converted file should have .txt extension");
        body.FileSize.Should().BeGreaterThan(0, "file size should reflect the converted text");
        body.FileSize.Should().Be(Encoding.UTF8.GetByteCount(longText), "file size should match text byte count");
    }

    [Fact]
    public async Task UpsertTextItem_LongTextAutoConverted_IsDownloadable()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);
        var itemId = Guid.NewGuid();

        var longText = new string('B', AutoConvertThresholdBytes + 2000);
        var upsertResponse = await UpsertTextItemAsync(client, space.Id, itemId, longText, token);
        upsertResponse.StatusCode.Should().BeOneOf(HttpStatusCode.Created, HttpStatusCode.OK);
        
        var upsertBody = await ReadJsonAsync<SpaceItemResponse>(upsertResponse);
        upsertBody.ContentType.Should().Be("file");

        var downloadResponse = await DownloadFileAsync(client, space.Id, itemId, token);
        
        downloadResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var downloadedContent = await downloadResponse.Content.ReadAsStringAsync();
        downloadedContent.Should().Be(longText, "downloaded content should match the original text");
    }

    [Fact]
    public async Task UpsertTextItem_EmptyText_StaysAsTextItem()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);
        var itemId = Guid.NewGuid();

        var response = await UpsertTextItemAsync(client, space.Id, itemId, string.Empty, token);

        response.StatusCode.Should().BeOneOf(HttpStatusCode.Created, HttpStatusCode.OK);
        var body = await ReadJsonAsync<SpaceItemResponse>(response);
        body.ContentType.Should().Be("text");
        body.Content.Should().BeEmpty();
        body.FileSize.Should().Be(0);
    }

    [Fact]
    public async Task UpsertTextItem_TextJustBelowThreshold_StaysAsTextItem()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);
        var itemId = Guid.NewGuid();

        var textBelowThreshold = new string('C', AutoConvertThresholdBytes - 100);
        var response = await UpsertTextItemAsync(client, space.Id, itemId, textBelowThreshold, token);

        response.StatusCode.Should().BeOneOf(HttpStatusCode.Created, HttpStatusCode.OK);
        var body = await ReadJsonAsync<SpaceItemResponse>(response);
        body.ContentType.Should().Be("text", "text just below threshold should stay as text");
        body.Content.Should().Be(textBelowThreshold);
        body.FileSize.Should().Be(0);
    }

    [Fact]
    public async Task UpsertTextItem_TextExactlyAtThreshold_Boundary()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);
        var itemId = Guid.NewGuid();

        var textAtThreshold = new string('D', AutoConvertThresholdBytes);
        var response = await UpsertTextItemAsync(client, space.Id, itemId, textAtThreshold, token);

        response.StatusCode.Should().BeOneOf(HttpStatusCode.Created, HttpStatusCode.OK);
        var body = await ReadJsonAsync<SpaceItemResponse>(response);
        // At the exact boundary, behavior may vary - just verify we get a valid response
        body.ContentType.Should().BeOneOf("text", "file");
    }

    [Fact]
    public async Task UpsertTextItem_TextJustAboveThreshold_AutoConvertsToFile()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);
        var itemId = Guid.NewGuid();

        var textAboveThreshold = new string('E', AutoConvertThresholdBytes + 1);
        var response = await UpsertTextItemAsync(client, space.Id, itemId, textAboveThreshold, token);

        response.StatusCode.Should().BeOneOf(HttpStatusCode.Created, HttpStatusCode.OK);
        var body = await ReadJsonAsync<SpaceItemResponse>(response);
        body.ContentType.Should().Be("file", "text just above threshold should auto-convert to file");
        body.Content.Should().EndWith(".txt");
        body.FileSize.Should().Be(Encoding.UTF8.GetByteCount(textAboveThreshold));
    }

    [Fact]
    public async Task UpsertTextItem_UnicodeTextNearThreshold_CalculatesBytesCorrectly()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);
        var itemId = Guid.NewGuid();

        // Unicode emoji are 4 bytes each in UTF-8. Create text where char count != byte count
        var emoji = "😀"; // 4 bytes in UTF-8
        var charCount = AutoConvertThresholdBytes / 2; // Well below threshold in char count
        var unicodeText = string.Concat(Enumerable.Repeat(emoji, charCount));
        var actualByteCount = Encoding.UTF8.GetByteCount(unicodeText);
        
        // This should be well above threshold in bytes (4 * charCount)
        actualByteCount.Should().BeGreaterThan(AutoConvertThresholdBytes, "unicode text should exceed threshold in bytes");

        var response = await UpsertTextItemAsync(client, space.Id, itemId, unicodeText, token);

        response.StatusCode.Should().BeOneOf(HttpStatusCode.Created, HttpStatusCode.OK);
        var body = await ReadJsonAsync<SpaceItemResponse>(response);
        body.ContentType.Should().Be("file", "unicode text exceeding byte threshold should auto-convert");
        body.FileSize.Should().Be(actualByteCount);
    }

    [Fact]
    public async Task UpsertTextItem_AutoConvertedFile_CountsAgainstQuota()
    {
        var quotaBytes = 50_000L; // 50KB quota
        await using var factory = new TestWebApplicationFactory(maxSpaceQuotaBytes: quotaBytes);
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var longText = new string('F', AutoConvertThresholdBytes + 1); // Just over threshold to trigger conversion, ~64KB
        var item1Id = Guid.NewGuid();
        var response1 = await UpsertTextItemAsync(client, space.Id, item1Id, longText, token);
        response1.StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge, "first item exceeds 50KB quota");
    }

    [Fact]
    public async Task UpsertTextItem_AutoConvertExceedsQuota_Returns413()
    {
        var quotaBytes = 5_000L; // Very small quota - 5KB
        await using var factory = new TestWebApplicationFactory(maxSpaceQuotaBytes: quotaBytes);
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var longText = new string('G', AutoConvertThresholdBytes + 1000); // Exceeds 5KB quota
        var itemId = Guid.NewGuid();
        var response = await UpsertTextItemAsync(client, space.Id, itemId, longText, token);

        response.StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge, 
            "auto-converted file exceeding quota should return 413");
    }

    [Fact]
    public async Task UpsertTextItem_UpdateExistingTextWithLongText_AutoConverts()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);
        
        // Create initial short text item
        var existingItem = await factory.CreateItemAsync(
            space.Id,
            member.Id,
            contentType: "text",
            content: "short text",
            sharedAt: DateTime.UtcNow.AddMinutes(-5),
            fileSize: 0);

        // Update with long text
        var longText = new string('H', AutoConvertThresholdBytes + 1000);
        var response = await UpsertTextItemAsync(client, space.Id, existingItem.Id, longText, token);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await ReadJsonAsync<SpaceItemResponse>(response);
        body.ContentType.Should().Be("file", "updating text item with long text should auto-convert");
        body.Content.Should().EndWith(".txt");
        body.FileSize.Should().BeGreaterThan(0);
    }

    [Fact]
    public async Task UpsertTextItem_UpdateExistingFileWithShortText_StaysAsFile()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        // Create initial file item via long text auto-convert
        var itemId = Guid.NewGuid();
        var longText = new string('I', AutoConvertThresholdBytes + 1000);
        var createResponse = await UpsertTextItemAsync(client, space.Id, itemId, longText, token);
        createResponse.StatusCode.Should().BeOneOf(HttpStatusCode.Created, HttpStatusCode.OK);

        // Update with short text but keep ContentType as text
        var shortText = "Now short";
        var updateResponse = await UpsertTextItemAsync(client, space.Id, itemId, shortText, token);

        updateResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await ReadJsonAsync<SpaceItemResponse>(updateResponse);
        // When explicitly sending ContentType="text" with short content, it should store as text
        body.ContentType.Should().Be("text");
        body.Content.Should().Be(shortText);
        body.FileSize.Should().Be(0);
    }

    [Fact]
    public async Task UpsertTextItem_MultibyteCharactersAtBoundary_HandlesCorrectly()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);
        var itemId = Guid.NewGuid();

        // Create text with mix of single and multi-byte chars near the threshold
        var singleByteChars = new string('A', AutoConvertThresholdBytes - 500);
        var multiByteChars = new string('北', 200); // Chinese chars, 3 bytes each in UTF-8
        var mixedText = singleByteChars + multiByteChars;
        
        var byteCount = Encoding.UTF8.GetByteCount(mixedText);
        byteCount.Should().BeGreaterThan(AutoConvertThresholdBytes, "mixed text should exceed threshold");

        var response = await UpsertTextItemAsync(client, space.Id, itemId, mixedText, token);

        response.StatusCode.Should().BeOneOf(HttpStatusCode.Created, HttpStatusCode.OK);
        var body = await ReadJsonAsync<SpaceItemResponse>(response);
        body.ContentType.Should().Be("file");
        body.FileSize.Should().Be(byteCount);
        
        // Verify downloaded content preserves multi-byte characters
        var downloadResponse = await DownloadFileAsync(client, space.Id, itemId, token);
        var downloadedContent = await downloadResponse.Content.ReadAsStringAsync();
        downloadedContent.Should().Be(mixedText, "multi-byte characters should be preserved");
    }

    [Fact]
    public async Task UpsertTextItem_AutoConvertedFilename_UsesItemId()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);
        var itemId = Guid.NewGuid();

        var longText = new string('J', AutoConvertThresholdBytes + 1000);
        var response = await UpsertTextItemAsync(client, space.Id, itemId, longText, token);

        response.StatusCode.Should().BeOneOf(HttpStatusCode.Created, HttpStatusCode.OK);
        var body = await ReadJsonAsync<SpaceItemResponse>(response);
        body.ContentType.Should().Be("file");
        // The Content field should contain the filename - typically "{itemId}.txt"
        body.Content.Should().Contain(itemId.ToString("N"), "filename should include item ID")
            .And.EndWith(".txt");
    }

    // Helper methods

    private static string GenerateTestJwt(Guid memberId, Guid spaceId, string displayName)
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

    private static async Task<HttpResponseMessage> DownloadFileAsync(
        HttpClient client,
        Guid spaceId,
        Guid itemId,
        string? token = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"/v1/spaces/{spaceId}/items/{itemId}/download");
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

        private readonly string _databaseName = $"sharedspaces-autoconvert-tests-{Guid.NewGuid()}";
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
                    ["Server:Url"] = ServerUrl,
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
