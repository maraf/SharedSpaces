using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Security.Claims;
using System.Text;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.Tokens;
using SharedSpaces.Server.Domain;
using SharedSpaces.Server.Infrastructure.Persistence;

namespace SharedSpaces.Server.Tests;

public class SpaceHubTests
{
    [Fact]
    public async Task ConnectToHub_WithValidJwt_Succeeds()
    {
        await using var factory = new TestWebApplicationFactory();
        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        await using var connection = CreateHubConnection(factory, space.Id, token);

        await connection.StartAsync();
        connection.State.Should().Be(HubConnectionState.Connected);
    }

    [Fact]
    public async Task ConnectToHub_WithoutJwt_Fails()
    {
        await using var factory = new TestWebApplicationFactory();
        var space = await factory.CreateSpaceAsync();

        await using var connection = CreateHubConnection(factory, space.Id, null);

        var act = async () => await connection.StartAsync();
        await act.Should().ThrowAsync<HttpRequestException>()
            .Where(ex => ex.StatusCode == HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task ConnectToHub_WithInvalidJwt_Fails()
    {
        await using var factory = new TestWebApplicationFactory();
        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var validToken = GenerateTestJwt(member.Id, space.Id, member.DisplayName);
        var invalidToken = validToken[..^1] + (validToken[^1] == 'a' ? 'b' : 'a');

        await using var connection = CreateHubConnection(factory, space.Id, invalidToken);

        var act = async () => await connection.StartAsync();
        await act.Should().ThrowAsync<HttpRequestException>()
            .Where(ex => ex.StatusCode == HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task ConnectToHub_WithRevokedMember_Fails()
    {
        await using var factory = new TestWebApplicationFactory();
        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        await factory.WithDbContextAsync(async db =>
        {
            var dbMember = await db.SpaceMembers.SingleAsync(m => m.Id == member.Id);
            dbMember.IsRevoked = true;
            await db.SaveChangesAsync();
        });

        await using var connection = CreateHubConnection(factory, space.Id, token);

        var act = async () => await connection.StartAsync();
        await act.Should().ThrowAsync<HttpRequestException>()
            .Where(ex => ex.StatusCode == HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task ConnectToHub_WithMalformedJwt_Fails()
    {
        await using var factory = new TestWebApplicationFactory();
        var space = await factory.CreateSpaceAsync();

        await using var connection = CreateHubConnection(factory, space.Id, "not-a-valid-jwt-token");

        var act = async () => await connection.StartAsync();
        await act.Should().ThrowAsync<HttpRequestException>()
            .Where(ex => ex.StatusCode == HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task ConnectToHub_AutoJoinsSpaceGroup_OnConnectedAsync()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();
        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var receivedEvent = new TaskCompletionSource<ItemAddedEvent>(TaskCreationOptions.RunContinuationsAsynchronously);
        await using var connection = CreateHubConnection(factory, space.Id, token);
        connection.On<ItemAddedEvent>("ItemAdded", evt =>
        {
            receivedEvent.TrySetResult(evt);
        });

        await connection.StartAsync();

        var itemId = Guid.NewGuid();
        var response = await PutTextItemAsync(client, space.Id, itemId, "Test message", token);
        response.EnsureSuccessStatusCode();

        var receivedTask = await Task.WhenAny(receivedEvent.Task, Task.Delay(TimeSpan.FromSeconds(5)));
        receivedTask.Should().Be(receivedEvent.Task, "connected clients should auto-join the space group on connect");

        var evt = await receivedEvent.Task;
        evt.Id.Should().Be(itemId);
        evt.SpaceId.Should().Be(space.Id);
    }

    [Fact]
    public async Task ConnectToHub_WithMismatchedRouteSpaceId_DoesNotReceiveEvents()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();
        var claimSpace = await factory.CreateSpaceAsync("Claim Space");
        var hubSpace = await factory.CreateSpaceAsync("Hub Space");
        var member = await factory.CreateMemberAsync(claimSpace.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, claimSpace.Id, member.DisplayName);

        var receivedEvent = new TaskCompletionSource<ItemAddedEvent>(TaskCreationOptions.RunContinuationsAsynchronously);
        await using var connection = CreateHubConnection(factory, hubSpace.Id, token);
        connection.On<ItemAddedEvent>("ItemAdded", evt =>
        {
            receivedEvent.TrySetResult(evt);
        });

        await connection.StartAsync();

        var itemId = Guid.NewGuid();
        var response = await PutTextItemAsync(client, claimSpace.Id, itemId, "Test message", token);
        response.EnsureSuccessStatusCode();

        var receivedTask = await Task.WhenAny(receivedEvent.Task, Task.Delay(TimeSpan.FromSeconds(2)));
        receivedTask.Should().NotBe(receivedEvent.Task, "clients with a mismatched route space should never join the broadcast group");
    }

    [Fact]
    public async Task ItemAdded_BroadcastsToConnectedClient()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();
        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var receivedEvent = new TaskCompletionSource<ItemAddedEvent>(TaskCreationOptions.RunContinuationsAsynchronously);
        await using var connection = CreateHubConnection(factory, space.Id, token);
        connection.On<ItemAddedEvent>("ItemAdded", evt =>
        {
            receivedEvent.TrySetResult(evt);
        });

        await connection.StartAsync();

        var itemId = Guid.NewGuid();
        var textContent = "Test message";
        var response = await PutTextItemAsync(client, space.Id, itemId, textContent, token);
        response.EnsureSuccessStatusCode();

        var receivedTask = await Task.WhenAny(receivedEvent.Task, Task.Delay(TimeSpan.FromSeconds(5)));
        receivedTask.Should().Be(receivedEvent.Task, "ItemAdded event should be received within 5 seconds");

        var evt = await receivedEvent.Task;
        evt.Id.Should().Be(itemId);
        evt.ContentType.Should().Be("text");
        evt.Content.Should().Be(textContent);
        evt.MemberId.Should().Be(member.Id);
        evt.DisplayName.Should().Be(member.DisplayName);
        evt.SharedAt.Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromSeconds(5));
    }

    [Fact]
    public async Task ItemAdded_FileItem_BroadcastsWithFullData()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();
        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var receivedEvent = new TaskCompletionSource<ItemAddedEvent>(TaskCreationOptions.RunContinuationsAsynchronously);
        await using var connection = CreateHubConnection(factory, space.Id, token);
        connection.On<ItemAddedEvent>("ItemAdded", evt =>
        {
            receivedEvent.TrySetResult(evt);
        });

        await connection.StartAsync();

        var itemId = Guid.NewGuid();
        var fileName = "test.txt";
        var fileContent = "File content"u8.ToArray();
        var response = await PutFileItemAsync(client, space.Id, itemId, fileName, fileContent, token);
        response.EnsureSuccessStatusCode();

        var receivedTask = await Task.WhenAny(receivedEvent.Task, Task.Delay(TimeSpan.FromSeconds(5)));
        receivedTask.Should().Be(receivedEvent.Task, "ItemAdded event should be received within 5 seconds");

        var evt = await receivedEvent.Task;
        evt.Id.Should().Be(itemId);
        evt.ContentType.Should().Be("file");
        evt.Content.Should().Be(fileName);
        evt.MemberId.Should().Be(member.Id);
        evt.DisplayName.Should().Be(member.DisplayName);
        evt.SharedAt.Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromSeconds(5));
    }

    [Fact]
    public async Task ItemDeleted_BroadcastsToConnectedClient()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();
        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var receivedEvent = new TaskCompletionSource<ItemDeletedEvent>(TaskCreationOptions.RunContinuationsAsynchronously);
        await using var connection = CreateHubConnection(factory, space.Id, token);
        connection.On<ItemDeletedEvent>("ItemDeleted", evt =>
        {
            receivedEvent.TrySetResult(evt);
        });

        await connection.StartAsync();

        var itemId = Guid.NewGuid();
        var putResponse = await PutTextItemAsync(client, space.Id, itemId, "Test message", token);
        putResponse.EnsureSuccessStatusCode();
        var deleteResponse = await DeleteItemAsync(client, space.Id, itemId, token);
        deleteResponse.EnsureSuccessStatusCode();

        var receivedTask = await Task.WhenAny(receivedEvent.Task, Task.Delay(TimeSpan.FromSeconds(5)));
        receivedTask.Should().Be(receivedEvent.Task, "ItemDeleted event should be received within 5 seconds");

        var evt = await receivedEvent.Task;
        evt.Id.Should().Be(itemId);
    }

    [Fact]
    public async Task ClientConnectedToDifferentSpace_DoesNotReceiveEvents()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();
        var receivingSpace = await factory.CreateSpaceAsync("Receiving Space");
        var sendingSpace = await factory.CreateSpaceAsync("Sending Space");
        var receivingMember = await factory.CreateMemberAsync(receivingSpace.Id, "Zoe");
        var receivingToken = GenerateTestJwt(receivingMember.Id, receivingSpace.Id, receivingMember.DisplayName);
        var sendingMember = await factory.CreateMemberAsync(sendingSpace.Id, "Mal");
        var sendingToken = GenerateTestJwt(sendingMember.Id, sendingSpace.Id, sendingMember.DisplayName);

        var receivedEvent = new TaskCompletionSource<ItemAddedEvent>(TaskCreationOptions.RunContinuationsAsynchronously);
        await using var connection = CreateHubConnection(factory, receivingSpace.Id, receivingToken);
        connection.On<ItemAddedEvent>("ItemAdded", evt =>
        {
            receivedEvent.TrySetResult(evt);
        });

        await connection.StartAsync();

        var itemId = Guid.NewGuid();
        var response = await PutTextItemAsync(client, sendingSpace.Id, itemId, "Test message", sendingToken);
        response.EnsureSuccessStatusCode();

        var receivedTask = await Task.WhenAny(receivedEvent.Task, Task.Delay(TimeSpan.FromSeconds(2)));
        receivedTask.Should().NotBe(receivedEvent.Task, "clients should only receive events for the space they connected to");
    }

    [Fact]
    public async Task MultipleClientsInSameSpace_AllReceiveBroadcast()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();
        var space = await factory.CreateSpaceAsync();
        var member1 = await factory.CreateMemberAsync(space.Id, "Zoe");
        var member2 = await factory.CreateMemberAsync(space.Id, "Mal");
        var token1 = GenerateTestJwt(member1.Id, space.Id, member1.DisplayName);
        var token2 = GenerateTestJwt(member2.Id, space.Id, member2.DisplayName);

        var receivedEvent1 = new TaskCompletionSource<ItemAddedEvent>(TaskCreationOptions.RunContinuationsAsynchronously);
        var receivedEvent2 = new TaskCompletionSource<ItemAddedEvent>(TaskCreationOptions.RunContinuationsAsynchronously);

        await using var connection1 = CreateHubConnection(factory, space.Id, token1);
        await using var connection2 = CreateHubConnection(factory, space.Id, token2);

        connection1.On<ItemAddedEvent>("ItemAdded", evt =>
        {
            receivedEvent1.TrySetResult(evt);
        });
        connection2.On<ItemAddedEvent>("ItemAdded", evt =>
        {
            receivedEvent2.TrySetResult(evt);
        });

        await connection1.StartAsync();
        await connection2.StartAsync();

        var itemId = Guid.NewGuid();
        var response = await PutTextItemAsync(client, space.Id, itemId, "Test message", token1);
        response.EnsureSuccessStatusCode();

        var received1Task = await Task.WhenAny(receivedEvent1.Task, Task.Delay(TimeSpan.FromSeconds(5)));
        var received2Task = await Task.WhenAny(receivedEvent2.Task, Task.Delay(TimeSpan.FromSeconds(5)));

        received1Task.Should().Be(receivedEvent1.Task, "First client should receive ItemAdded event");
        received2Task.Should().Be(receivedEvent2.Task, "Second client should receive ItemAdded event");

        var evt1 = await receivedEvent1.Task;
        var evt2 = await receivedEvent2.Task;

        evt1.Id.Should().Be(itemId);
        evt2.Id.Should().Be(itemId);
    }

    [Fact]
    public async Task DisconnectAndReconnect_AutoRejoinsSpaceGroup()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();
        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var receivedEvent = new TaskCompletionSource<ItemAddedEvent>(TaskCreationOptions.RunContinuationsAsynchronously);
        await using var connection = CreateHubConnection(factory, space.Id, token);
        connection.On<ItemAddedEvent>("ItemAdded", evt =>
        {
            receivedEvent.TrySetResult(evt);
        });

        await connection.StartAsync();
        await connection.StopAsync();

        await connection.StartAsync();

        var itemId = Guid.NewGuid();
        var response = await PutTextItemAsync(client, space.Id, itemId, "Test message", token);
        response.EnsureSuccessStatusCode();

        var receivedTask = await Task.WhenAny(receivedEvent.Task, Task.Delay(TimeSpan.FromSeconds(5)));
        receivedTask.Should().Be(receivedEvent.Task, "ItemAdded event should be received after reconnect");

        var evt = await receivedEvent.Task;
        evt.Id.Should().Be(itemId);
    }

    [Fact]
    public async Task ConnectToHub_WithNonExistentSpace_DoesNotReceiveEvents()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();
        var nonExistentSpaceId = Guid.NewGuid();
        var fakeSpace = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(fakeSpace.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, fakeSpace.Id, member.DisplayName);

        var receivedEvent = new TaskCompletionSource<ItemAddedEvent>(TaskCreationOptions.RunContinuationsAsynchronously);
        await using var connection = CreateHubConnection(factory, nonExistentSpaceId, token);
        connection.On<ItemAddedEvent>("ItemAdded", evt =>
        {
            receivedEvent.TrySetResult(evt);
        });

        await connection.StartAsync();

        var itemId = Guid.NewGuid();
        var response = await PutTextItemAsync(client, fakeSpace.Id, itemId, "Test message", token);
        response.EnsureSuccessStatusCode();

        var receivedTask = await Task.WhenAny(receivedEvent.Task, Task.Delay(TimeSpan.FromSeconds(2)));
        receivedTask.Should().NotBe(receivedEvent.Task, "clients connected with a non-existent route space should never join a broadcast group");
    }

    private static HubConnection CreateHubConnection(
        TestWebApplicationFactory factory,
        Guid spaceId,
        string? token)
    {
        var url = $"{factory.Server.BaseAddress}v1/spaces/{spaceId}/hub";

        var builder = new HubConnectionBuilder()
            .WithUrl(url, options =>
            {
                options.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
                if (!string.IsNullOrWhiteSpace(token))
                {
                    options.AccessTokenProvider = () => Task.FromResult<string?>(token);
                }
            });

        return builder.Build();
    }

    private static string GenerateTestJwt(Guid memberId, Guid spaceId, string displayName)
    {
        var signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(TestWebApplicationFactory.JwtSigningKey));
        var credentials = new SigningCredentials(signingKey, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, memberId.ToString()),
            new Claim("display_name", displayName),
            new Claim("server_url", TestWebApplicationFactory.ServerUrl),
            new Claim("space_id", spaceId.ToString())
        };

        var token = new JwtSecurityToken(
            issuer: null,
            audience: null,
            claims: claims,
            expires: null,
            signingCredentials: credentials
        );

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    private static async Task<HttpResponseMessage> PutTextItemAsync(
        HttpClient client,
        Guid spaceId,
        Guid itemId,
        string content,
        string token)
    {
        using var request = new HttpRequestMessage(HttpMethod.Put, $"/v1/spaces/{spaceId}/items/{itemId}");
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var formContent = new MultipartFormDataContent
        {
            { new StringContent(itemId.ToString()), "id" },
            { new StringContent("text"), "contentType" },
            { new StringContent(content), "content" }
        };
        request.Content = formContent;

        return await client.SendAsync(request);
    }

    private static async Task<HttpResponseMessage> PutFileItemAsync(
        HttpClient client,
        Guid spaceId,
        Guid itemId,
        string fileName,
        byte[] fileContent,
        string token)
    {
        using var request = new HttpRequestMessage(HttpMethod.Put, $"/v1/spaces/{spaceId}/items/{itemId}");
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var formContent = new MultipartFormDataContent
        {
            { new StringContent(itemId.ToString()), "id" },
            { new StringContent("file"), "contentType" },
            { new ByteArrayContent(fileContent), "file", fileName }
        };
        request.Content = formContent;

        return await client.SendAsync(request);
    }

    private static async Task<HttpResponseMessage> DeleteItemAsync(
        HttpClient client,
        Guid spaceId,
        Guid itemId,
        string token)
    {
        using var request = new HttpRequestMessage(HttpMethod.Delete, $"/v1/spaces/{spaceId}/items/{itemId}");
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        return await client.SendAsync(request);
    }

    private sealed record ItemAddedEvent(
        Guid Id,
        Guid SpaceId,
        Guid MemberId,
        string DisplayName,
        string ContentType,
        string Content,
        long FileSize,
        DateTime SharedAt);

    private sealed record ItemDeletedEvent(Guid Id, Guid SpaceId);

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

        public async Task<SpaceMember> CreateMemberAsync(Guid spaceId, string displayName)
        {
            return await WithDbContextAsync(async db =>
            {
                var member = new SpaceMember
                {
                    Id = Guid.NewGuid(),
                    SpaceId = spaceId,
                    DisplayName = displayName,
                    IsRevoked = false,
                    JoinedAt = DateTime.UtcNow
                };

                db.SpaceMembers.Add(member);
                await db.SaveChangesAsync();
                return member;
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
