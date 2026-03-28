using System.Net;
using System.Net.Http.Headers;
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

public class TokenEndpointTests
{
    [Fact]
    public async Task ExchangeValidPinForJwt_ReturnsToken()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var pin = "123456";
        var displayName = "Zoe";
        var space = await factory.CreateSpaceAsync();
        await factory.CreateInvitationAsync(space.Id, pin);

        var response = await ExchangeTokenAsync(client, space.Id, pin, displayName);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var token = await ReadTokenAsync(response);
        token.Should().NotBeNullOrWhiteSpace();
        token.Split('.').Should().HaveCount(3);
        await AssertJwtClaimsAsync(factory, token, space.Id, displayName);
    }

    [Fact]
    public async Task JwtContainsExpectedClaims()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var pin = "123456";
        var displayName = "Zoe";
        var space = await factory.CreateSpaceAsync();
        await factory.CreateInvitationAsync(space.Id, pin);

        var response = await ExchangeTokenAsync(client, space.Id, pin, displayName);
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var token = await ReadTokenAsync(response);
        await AssertJwtClaimsAsync(factory, token, space.Id, displayName);
    }

    [Fact]
    public async Task InvitationDeletedAfterTokenIssuance()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var pin = "123456";
        var displayName = "Zoe";
        var space = await factory.CreateSpaceAsync();
        var invitation = await factory.CreateInvitationAsync(space.Id, pin);

        var response = await ExchangeTokenAsync(client, space.Id, pin, displayName);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var token = await ReadTokenAsync(response);
        await AssertJwtClaimsAsync(factory, token, space.Id, displayName);
        var invitationStillExists = await factory.WithDbContextAsync(db => db.SpaceInvitations.AnyAsync(x => x.Id == invitation.Id));
        invitationStillExists.Should().BeFalse();
    }

    [Fact]
    public async Task SpaceMemberCreatedAfterTokenIssuance()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var beforeExchange = DateTime.UtcNow;
        var pin = "123456";
        var displayName = "Zoe";
        var space = await factory.CreateSpaceAsync();
        await factory.CreateInvitationAsync(space.Id, pin);

        var response = await ExchangeTokenAsync(client, space.Id, pin, displayName);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var token = await ReadTokenAsync(response);
        var tokenMemberId = await AssertJwtClaimsAsync(factory, token, space.Id, displayName);
        var member = await factory.WithDbContextAsync(db => db.SpaceMembers.SingleAsync());
        member.Id.Should().Be(tokenMemberId);
        member.SpaceId.Should().Be(space.Id);
        member.DisplayName.Should().Be(displayName);
        member.IsRevoked.Should().BeFalse();
        member.JoinedAt.Should().BeOnOrAfter(beforeExchange.AddSeconds(-1));
        member.JoinedAt.Should().BeOnOrBefore(DateTime.UtcNow.AddSeconds(1));
    }

    [Fact]
    public async Task InvalidPin_Returns401()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        await factory.CreateInvitationAsync(space.Id, "123456");

        var response = await ExchangeTokenAsync(client, space.Id, "654321", "Zoe");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task NonExistentSpace_Returns404()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var response = await ExchangeTokenAsync(client, Guid.NewGuid(), "123456", "Zoe");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task NoInvitationsForSpace_Returns401()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();

        var response = await ExchangeTokenAsync(client, space.Id, "123456", "Zoe");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task AuthenticatedEndpoint_WithValidJwt_Succeeds()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var pin = "123456";
        var displayName = "Zoe";
        var space = await factory.CreateSpaceAsync();
        await factory.CreateInvitationAsync(space.Id, pin);

        var tokenResponse = await ExchangeTokenAsync(client, space.Id, pin, displayName);
        tokenResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var token = await ReadTokenAsync(tokenResponse);
        await AssertJwtClaimsAsync(factory, token, space.Id, displayName);

        var response = await GetProtectedEndpointAsync(client, token);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task AuthenticatedEndpoint_WithoutJwt_Returns401()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var response = await GetProtectedEndpointAsync(client);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task AuthenticatedEndpoint_WithRevokedMember_Returns401()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var pin = "123456";
        var displayName = "Zoe";
        var space = await factory.CreateSpaceAsync();
        await factory.CreateInvitationAsync(space.Id, pin);

        var tokenResponse = await ExchangeTokenAsync(client, space.Id, pin, displayName);
        tokenResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var token = await ReadTokenAsync(tokenResponse);
        await AssertJwtClaimsAsync(factory, token, space.Id, displayName);

        await factory.WithDbContextAsync(async db =>
        {
            var member = await db.SpaceMembers.SingleAsync();
            member.IsRevoked = true;
            await db.SaveChangesAsync();
        });

        var response = await GetProtectedEndpointAsync(client, token);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task AuthenticatedEndpoint_WithInvalidJwt_Returns401()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var pin = "123456";
        var displayName = "Zoe";
        var space = await factory.CreateSpaceAsync();
        await factory.CreateInvitationAsync(space.Id, pin);

        var tokenResponse = await ExchangeTokenAsync(client, space.Id, pin, displayName);
        tokenResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var token = await ReadTokenAsync(tokenResponse);
        await AssertJwtClaimsAsync(factory, token, space.Id, displayName);
        var invalidToken = token[..^1] + (token[^1] == 'a' ? 'b' : 'a');

        var response = await GetProtectedEndpointAsync(client, invalidToken);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task JwtHasNoExpiration()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var pin = "123456";
        var displayName = "Zoe";
        var space = await factory.CreateSpaceAsync();
        await factory.CreateInvitationAsync(space.Id, pin);

        var response = await ExchangeTokenAsync(client, space.Id, pin, displayName);
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var token = await ReadTokenAsync(response);
        await AssertJwtClaimsAsync(factory, token, space.Id, displayName);
        var payload = DecodeJwtPayload(token);

        payload.Should().NotContainKey("exp");
    }

    [Fact]
    public async Task DisplayNameTooLong_Returns400()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var pin = "123456";
        var space = await factory.CreateSpaceAsync();
        await factory.CreateInvitationAsync(space.Id, pin);

        var response = await ExchangeTokenAsync(client, space.Id, pin, new string('x', 101));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    // ========== Simplified token endpoint (PIN-only join) ==========

    [Fact]
    public async Task SimplifiedJoin_WithValidPin_ReturnsToken()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var pin = "123456";
        var displayName = "Zoe";
        var space = await factory.CreateSpaceAsync();
        await factory.CreateInvitationAsync(space.Id, pin);

        var response = await ExchangeTokenSimplifiedAsync(client, pin, displayName);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var token = await ReadTokenAsync(response);
        token.Should().NotBeNullOrWhiteSpace();
        token.Split('.').Should().HaveCount(3);
    }

    [Fact]
    public async Task SimplifiedJoin_JwtContainsCorrectSpaceId()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var pin = "123456";
        var displayName = "Zoe";
        var space = await factory.CreateSpaceAsync("My Space");
        await factory.CreateInvitationAsync(space.Id, pin);

        var response = await ExchangeTokenSimplifiedAsync(client, pin, displayName);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var token = await ReadTokenAsync(response);
        var payload = DecodeJwtPayload(token);
        payload["space_id"].GetString().Should().Be(space.Id.ToString());
    }

    [Fact]
    public async Task SimplifiedJoin_InvitationDeletedAfterUse()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var pin = "123456";
        var space = await factory.CreateSpaceAsync();
        var invitation = await factory.CreateInvitationAsync(space.Id, pin);

        var response = await ExchangeTokenSimplifiedAsync(client, pin, "Zoe");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var invitationStillExists = await factory.WithDbContextAsync(db => db.SpaceInvitations.AnyAsync(x => x.Id == invitation.Id));
        invitationStillExists.Should().BeFalse();
    }

    [Fact]
    public async Task SimplifiedJoin_MemberCreated()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var pin = "123456";
        var displayName = "Zoe";
        var space = await factory.CreateSpaceAsync();
        await factory.CreateInvitationAsync(space.Id, pin);

        var response = await ExchangeTokenSimplifiedAsync(client, pin, displayName);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var member = await factory.WithDbContextAsync(db => db.SpaceMembers.SingleAsync());
        member.SpaceId.Should().Be(space.Id);
        member.DisplayName.Should().Be(displayName);
    }

    [Fact]
    public async Task SimplifiedJoin_NoMatchingInvitation_ReturnsUnauthorized()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        await factory.CreateInvitationAsync(space.Id, "123456");

        var response = await ExchangeTokenSimplifiedAsync(client, "654321", "Zoe");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task SimplifiedJoin_NoInvitationsAtAll_ReturnsUnauthorized()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var response = await ExchangeTokenSimplifiedAsync(client, "123456", "Zoe");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task SimplifiedJoin_PinCollision_ReturnsConflict()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var pin = "123456";
        var space1 = await factory.CreateSpaceAsync("Space One");
        var space2 = await factory.CreateSpaceAsync("Space Two");
        await factory.CreateInvitationAsync(space1.Id, pin);
        await factory.CreateInvitationAsync(space2.Id, pin);

        var response = await ExchangeTokenSimplifiedAsync(client, pin, "Zoe");

        response.StatusCode.Should().Be(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task SimplifiedJoin_WithExplicitSpaceId_BypassesCollisionCheck()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var pin = "123456";
        var space1 = await factory.CreateSpaceAsync("Space One");
        var space2 = await factory.CreateSpaceAsync("Space Two");
        await factory.CreateInvitationAsync(space1.Id, pin);
        await factory.CreateInvitationAsync(space2.Id, pin);

        var response = await ExchangeTokenWithOptionalSpaceIdAsync(client, pin, "Zoe", space1.Id);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var token = await ReadTokenAsync(response);
        var payload = DecodeJwtPayload(token);
        payload["space_id"].GetString().Should().Be(space1.Id.ToString());
    }

    [Fact]
    public async Task LegacyJoin_WithSpaceIdInRoute_StillWorks()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var pin = "123456";
        var displayName = "Zoe";
        var space = await factory.CreateSpaceAsync();
        await factory.CreateInvitationAsync(space.Id, pin);

        var response = await ExchangeTokenAsync(client, space.Id, pin, displayName);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var token = await ReadTokenAsync(response);
        await AssertJwtClaimsAsync(factory, token, space.Id, displayName);
    }

    private static Task<HttpResponseMessage> ExchangeTokenAsync(HttpClient client, Guid spaceId, string pin, string displayName)
    {
        return client.PostAsJsonAsync($"/v1/spaces/{spaceId}/tokens", new ExchangeTokenRequest(pin, displayName));
    }

    private static Task<HttpResponseMessage> ExchangeTokenSimplifiedAsync(HttpClient client, string pin, string displayName)
    {
        return client.PostAsJsonAsync("/v1/tokens", new ExchangeTokenSimplifiedRequest(pin, displayName, null));
    }

    private static Task<HttpResponseMessage> ExchangeTokenWithOptionalSpaceIdAsync(HttpClient client, string pin, string displayName, Guid? spaceId)
    {
        return client.PostAsJsonAsync("/v1/tokens", new ExchangeTokenSimplifiedRequest(pin, displayName, spaceId));
    }

    private static async Task<HttpResponseMessage> GetProtectedEndpointAsync(HttpClient client, string? token = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/test/protected");
        if (!string.IsNullOrWhiteSpace(token))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }

        return await client.SendAsync(request);
    }

    private static async Task<string> ReadTokenAsync(HttpResponseMessage response)
    {
        var tokenResponse = await response.Content.ReadFromJsonAsync<TokenResponse>();
        tokenResponse.Should().NotBeNull();
        tokenResponse!.Token.Should().NotBeNullOrWhiteSpace();
        return tokenResponse.Token;
    }

    private static async Task<Guid> AssertJwtClaimsAsync(
        TestWebApplicationFactory factory,
        string token,
        Guid expectedSpaceId,
        string expectedDisplayName)
    {
        var payload = DecodeJwtPayload(token);
        var member = await factory.WithDbContextAsync(db => db.SpaceMembers.SingleAsync());

        member.SpaceId.Should().Be(expectedSpaceId);
        member.DisplayName.Should().Be(expectedDisplayName);

        payload.Should().ContainKey("sub");
        payload["sub"].ValueKind.Should().Be(JsonValueKind.String);
        payload["sub"].GetString().Should().Be(member.Id.ToString());

        payload.Should().ContainKey("display_name");
        payload["display_name"].ValueKind.Should().Be(JsonValueKind.String);
        payload["display_name"].GetString().Should().Be(expectedDisplayName);

        payload.Should().ContainKey("server_url");
        payload["server_url"].ValueKind.Should().Be(JsonValueKind.String);
        payload["server_url"].GetString().Should().Be("http://localhost");

        payload.Should().ContainKey("space_id");
        payload["space_id"].ValueKind.Should().Be(JsonValueKind.String);
        payload["space_id"].GetString().Should().Be(expectedSpaceId.ToString());

        payload.Should().NotContainKey("exp");

        return member.Id;
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

    private sealed record ExchangeTokenRequest(string Pin, string DisplayName);

    private sealed record ExchangeTokenSimplifiedRequest(string Pin, string DisplayName, Guid? SpaceId);

    private sealed record TokenResponse(string Token);

    private sealed class TestWebApplicationFactory : WebApplicationFactory<Program>
    {
        public const string AdminSecret = "test-admin-secret";
        public const string JwtSigningKey = "test-signing-key-1234567890abcdef";
        public const string ServerUrl = "https://sharedspaces.test";

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
    }
}
