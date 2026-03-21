using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using SharedSpaces.Server.Domain;
using SharedSpaces.Server.Features.Invitations;
using SharedSpaces.Server.Infrastructure.Persistence;

namespace SharedSpaces.Server.Tests;

/// <summary>
/// Verifies that the server respects X-Forwarded-Proto and X-Forwarded-Host
/// headers when generating invitation URLs and token server URLs.
/// Covers issue #69: reverse proxy scheme propagation.
/// </summary>
public class ForwardedHeadersTests
{
    // ========== Invitation URL — X-Forwarded-Proto ==========

    [Fact]
    public async Task CreateInvitation_WithForwardedProtoHttps_InvitationUrlUsesHttpsScheme()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var response = await CreateInvitationWithHeadersAsync(
            client,
            space.Id,
            forwardedProto: "https");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var invitation = await ReadJsonAsync<InvitationResponse>(response);
        var serverUrl = ExtractServerUrl(invitation!.InvitationString);
        serverUrl.Should().StartWith("https://");
    }

    // ========== Invitation URL — X-Forwarded-Host ==========

    [Fact]
    public async Task CreateInvitation_WithForwardedHost_InvitationUrlUsesForwardedHost()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var response = await CreateInvitationWithHeadersAsync(
            client,
            space.Id,
            forwardedHost: "example.com");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var invitation = await ReadJsonAsync<InvitationResponse>(response);
        var serverUrl = ExtractServerUrl(invitation!.InvitationString);
        serverUrl.Should().Contain("example.com");
    }

    // ========== Invitation URL — Both headers ==========

    [Fact]
    public async Task CreateInvitation_WithBothForwardedHeaders_InvitationUrlReflectsBoth()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var response = await CreateInvitationWithHeadersAsync(
            client,
            space.Id,
            forwardedProto: "https",
            forwardedHost: "proxy.example.com");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var invitation = await ReadJsonAsync<InvitationResponse>(response);
        var serverUrl = ExtractServerUrl(invitation!.InvitationString);
        serverUrl.Should().Be("https://proxy.example.com");
    }

    // ========== Invitation URL — No forwarded headers (default) ==========

    [Fact]
    public async Task CreateInvitation_WithoutForwardedHeaders_UsesDefaultSchemeAndHost()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var response = await CreateInvitationWithHeadersAsync(client, space.Id);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var invitation = await ReadJsonAsync<InvitationResponse>(response);
        var serverUrl = ExtractServerUrl(invitation!.InvitationString);
        serverUrl.Should().Be("http://localhost");
    }

    // ========== Token server_url — X-Forwarded-Proto ==========

    [Fact]
    public async Task ExchangeToken_WithForwardedProtoHttps_ServerUrlClaimUsesHttpsScheme()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var pin = "123456";
        var space = await factory.CreateSpaceAsync();
        await factory.CreateInvitationAsync(space.Id, pin);

        var response = await ExchangeTokenWithHeadersAsync(
            client,
            space.Id,
            pin,
            "Zoe",
            forwardedProto: "https");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var token = await ReadTokenAsync(response);
        var serverUrl = ExtractServerUrlClaim(token);
        serverUrl.Should().StartWith("https://");
    }

    // ========== Token server_url — X-Forwarded-Host ==========

    [Fact]
    public async Task ExchangeToken_WithForwardedHost_ServerUrlClaimUsesForwardedHost()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var pin = "123456";
        var space = await factory.CreateSpaceAsync();
        await factory.CreateInvitationAsync(space.Id, pin);

        var response = await ExchangeTokenWithHeadersAsync(
            client,
            space.Id,
            pin,
            "Zoe",
            forwardedHost: "example.com");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var token = await ReadTokenAsync(response);
        var serverUrl = ExtractServerUrlClaim(token);
        serverUrl.Should().Contain("example.com");
    }

    // ========== Token server_url — Both headers ==========

    [Fact]
    public async Task ExchangeToken_WithBothForwardedHeaders_ServerUrlClaimReflectsBoth()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var pin = "123456";
        var space = await factory.CreateSpaceAsync();
        await factory.CreateInvitationAsync(space.Id, pin);

        var response = await ExchangeTokenWithHeadersAsync(
            client,
            space.Id,
            pin,
            "Zoe",
            forwardedProto: "https",
            forwardedHost: "proxy.example.com");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var token = await ReadTokenAsync(response);
        var serverUrl = ExtractServerUrlClaim(token);
        serverUrl.Should().Be("https://proxy.example.com");
    }

    // ========== Token server_url — No forwarded headers (default) ==========

    [Fact]
    public async Task ExchangeToken_WithoutForwardedHeaders_ServerUrlClaimUsesDefault()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var pin = "123456";
        var space = await factory.CreateSpaceAsync();
        await factory.CreateInvitationAsync(space.Id, pin);

        var response = await ExchangeTokenWithHeadersAsync(
            client,
            space.Id,
            pin,
            "Zoe");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var token = await ReadTokenAsync(response);
        var serverUrl = ExtractServerUrlClaim(token);
        serverUrl.Should().Be("http://localhost");
    }

    // ========== Helpers ==========

    private static async Task<HttpResponseMessage> CreateInvitationWithHeadersAsync(
        HttpClient client,
        Guid spaceId,
        string? forwardedProto = null,
        string? forwardedHost = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"/v1/spaces/{spaceId}/invitations");
        request.Headers.Add("X-Admin-Secret", TestWebApplicationFactory.AdminSecret);
        request.Content = JsonContent.Create(new CreateInvitationRequest(null));

        if (forwardedProto is not null)
            request.Headers.Add("X-Forwarded-Proto", forwardedProto);

        if (forwardedHost is not null)
            request.Headers.Add("X-Forwarded-Host", forwardedHost);

        return await client.SendAsync(request);
    }

    private static async Task<HttpResponseMessage> ExchangeTokenWithHeadersAsync(
        HttpClient client,
        Guid spaceId,
        string pin,
        string displayName,
        string? forwardedProto = null,
        string? forwardedHost = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"/v1/spaces/{spaceId}/tokens");
        request.Content = JsonContent.Create(new ExchangeTokenRequest(pin, displayName));

        if (forwardedProto is not null)
            request.Headers.Add("X-Forwarded-Proto", forwardedProto);

        if (forwardedHost is not null)
            request.Headers.Add("X-Forwarded-Host", forwardedHost);

        return await client.SendAsync(request);
    }

    private static string ExtractServerUrl(string invitationString)
    {
        var parts = invitationString.Split('|');
        parts.Should().HaveCount(3, "invitation string format is serverUrl|spaceId|pin");
        return parts[0];
    }

    private static string ExtractServerUrlClaim(string token)
    {
        var payload = DecodeJwtPayload(token);
        payload.Should().ContainKey("server_url");
        return payload["server_url"].GetString()!;
    }

    private static async Task<string> ReadTokenAsync(HttpResponseMessage response)
    {
        var tokenResponse = await response.Content.ReadFromJsonAsync<TokenResponse>();
        tokenResponse.Should().NotBeNull();
        tokenResponse!.Token.Should().NotBeNullOrWhiteSpace();
        return tokenResponse.Token;
    }

    private static Dictionary<string, JsonElement> DecodeJwtPayload(string token)
    {
        var segments = token.Split('.');
        segments.Should().HaveCount(3);

        var payloadBytes = DecodeBase64Url(segments[1]);
        return JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(payloadBytes)!;
    }

    private static byte[] DecodeBase64Url(string value)
    {
        var padded = value.Replace('-', '+').Replace('_', '/');
        padded += new string('=', (4 - padded.Length % 4) % 4);
        return Convert.FromBase64String(padded);
    }

    private static async Task<T?> ReadJsonAsync<T>(HttpResponseMessage response)
    {
        return await response.Content.ReadFromJsonAsync<T>();
    }

    // ========== DTOs ==========

    private sealed record CreateInvitationRequest(string? ClientAppUrl);

    private sealed record ExchangeTokenRequest(string Pin, string DisplayName);

    private sealed record InvitationResponse(string InvitationString, string? QrCodeBase64);

    private sealed record TokenResponse(string Token);

    // ========== Test Infrastructure ==========

    private sealed class TestWebApplicationFactory : WebApplicationFactory<Program>
    {
        public const string AdminSecret = "test-admin-secret";
        public const string JwtSigningKey = "test-signing-key-1234567890abcdef";

        private readonly string _databaseName = $"sharedspaces-tests-{Guid.NewGuid()}";

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");

            builder.ConfigureAppConfiguration((_, configBuilder) =>
            {
                configBuilder.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Admin:Secret"] = AdminSecret,
                    ["Jwt:SigningKey"] = JwtSigningKey,
                    ["Storage:BasePath"] = "./artifacts/storage-tests"
                });
            });

            builder.ConfigureServices(services =>
            {
                services.RemoveAll<DbContextOptions<AppDbContext>>();
                services.RemoveAll<IDbContextOptionsConfiguration<AppDbContext>>();
                services.RemoveAll<AppDbContext>();

                services.AddDbContext<AppDbContext>(options => options.UseInMemoryDatabase(_databaseName));
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

        public async Task<SpaceInvitation> CreateInvitationAsync(Guid spaceId, string pin)
        {
            return await WithDbContextAsync(async db =>
            {
                var invitation = new SpaceInvitation
                {
                    Id = Guid.NewGuid(),
                    SpaceId = spaceId,
                    Pin = InvitationPinHasher.HashPin(pin, AdminSecret)
                };

                db.SpaceInvitations.Add(invitation);
                await db.SaveChangesAsync();
                return invitation;
            });
        }

        public async Task<T> WithDbContextAsync<T>(Func<AppDbContext, Task<T>> action)
        {
            using var scope = Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            return await action(db);
        }
    }
}
