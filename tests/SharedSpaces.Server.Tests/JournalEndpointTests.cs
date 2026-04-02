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

public class JournalEndpointTests
{
    [Fact]
    public async Task GetJournal_ReturnsAddedItemsSinceStoredCheckpoint()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var checkpoint = DateTime.UtcNow.AddMinutes(-1);

        await factory.WithDbContextAsync(async db =>
        {
            var trackedMember = await db.SpaceMembers.SingleAsync(m => m.Id == member.Id);
            trackedMember.LastSyncAt = checkpoint;
            await db.SaveChangesAsync();
        });

        await factory.CreateItemAsync(
            space.Id, member.Id,
            contentType: "text",
            content: "old item",
            sharedAt: checkpoint.AddMinutes(-2),
            fileSize: 0);

        var item = await factory.CreateItemAsync(
            space.Id, member.Id,
            contentType: "text",
            content: "hello journal",
            sharedAt: DateTime.UtcNow,
            fileSize: 0);

        var response = await GetJournalAsync(client, space.Id, token);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await ReadJsonAsync<JournalResponse>(response);
        body.FullSyncRequired.Should().BeFalse();
        body.Checkpoint.Should().BeOnOrAfter(checkpoint);
        body.AddedOrUpdated.Should().ContainSingle(r => r.Id == item.Id);
        body.Deleted.Should().BeEmpty();
    }

    [Fact]
    public async Task GetJournal_ReturnsDeletedItemIdsSinceStoredCheckpoint()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var item = await factory.CreateItemAsync(
            space.Id, member.Id,
            contentType: "text",
            content: "to be deleted",
            sharedAt: DateTime.UtcNow.AddMinutes(-5),
            fileSize: 0);

        var beforeDelete = DateTime.UtcNow.AddSeconds(-1);

        await factory.WithDbContextAsync(async db =>
        {
            var trackedMember = await db.SpaceMembers.SingleAsync(m => m.Id == member.Id);
            trackedMember.LastSyncAt = beforeDelete;
            await db.SaveChangesAsync();
        });

        // Delete the item via API
        var deleteResponse = await DeleteItemAsync(client, space.Id, item.Id, token);
        deleteResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var response = await GetJournalAsync(client, space.Id, token);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await ReadJsonAsync<JournalResponse>(response);
        body.FullSyncRequired.Should().BeFalse();
        body.Deleted.Should().Contain(item.Id);
    }

    [Fact]
    public async Task GetJournal_ReturnsFullSyncRequired_WhenCheckpointIsBeforePrunedWatermark()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var checkpoint = DateTime.UtcNow.AddMinutes(-30);

        await factory.WithDbContextAsync(async db =>
        {
            var s = await db.Spaces.SingleAsync(s => s.Id == space.Id);
            s.JournalPrunedBefore = DateTime.UtcNow.AddMinutes(-10);
            var trackedMember = await db.SpaceMembers.SingleAsync(m => m.Id == member.Id);
            trackedMember.LastSyncAt = checkpoint;
            await db.SaveChangesAsync();
        });

        var response = await GetJournalAsync(client, space.Id, token);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await ReadJsonAsync<JournalResponse>(response);
        body.FullSyncRequired.Should().BeTrue();
        body.AddedOrUpdated.Should().BeEmpty();
        body.Deleted.Should().BeEmpty();
    }

    [Fact]
    public async Task GetJournal_ReturnsFullSyncRequired_WhenCheckpointEqualsWatermark()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var watermark = DateTime.UtcNow.AddMinutes(-10);

        await factory.WithDbContextAsync(async db =>
        {
            var s = await db.Spaces.SingleAsync(s => s.Id == space.Id);
            s.JournalPrunedBefore = watermark;
            var trackedMember = await db.SpaceMembers.SingleAsync(m => m.Id == member.Id);
            trackedMember.LastSyncAt = watermark;
            await db.SaveChangesAsync();
        });

        var response = await GetJournalAsync(client, space.Id, token);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await ReadJsonAsync<JournalResponse>(response);
        body.FullSyncRequired.Should().BeTrue();
        body.AddedOrUpdated.Should().BeEmpty();
    }

    [Fact]
    public async Task GetJournal_ReturnsFullSyncRequiredFalse_WhenJournalCoversWindow()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        await factory.WithDbContextAsync(async db =>
        {
            var trackedMember = await db.SpaceMembers.SingleAsync(m => m.Id == member.Id);
            trackedMember.LastSyncAt = DateTime.UtcNow.AddMinutes(-5);
            await db.SaveChangesAsync();
        });

        var response = await GetJournalAsync(client, space.Id, token);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await ReadJsonAsync<JournalResponse>(response);
        body.FullSyncRequired.Should().BeFalse();
    }

    [Fact]
    public async Task GetJournal_InitialCallEnablesJournalingWithoutAdvancingCheckpoint()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        // Verify LastSyncAt is initially null
        await factory.WithDbContextAsync(async db =>
        {
            var m = await db.SpaceMembers.SingleAsync(m => m.Id == member.Id);
            m.LastSyncAt.Should().BeNull();
        });

        var response = await GetJournalAsync(client, space.Id, token);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await ReadJsonAsync<JournalResponse>(response);
        body.Checkpoint.Should().BeOnOrAfter(DateTime.UtcNow.AddMinutes(-1));

        await factory.WithDbContextAsync(async db =>
        {
            var m = await db.SpaceMembers.SingleAsync(m => m.Id == member.Id);
            m.LastSyncAt.Should().NotBeNull();
            m.LastSyncAt!.Value.Should().Be(DateTime.SpecifyKind(DateTime.MinValue, DateTimeKind.Utc));
        });
    }

    [Fact]
    public async Task PostCheckpoint_UpdatesMemberLastSyncAt()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var journalResponse = await ReadJsonAsync<JournalResponse>(await GetJournalAsync(client, space.Id, token));

        var checkpointResponse = await PostCheckpointAsync(client, space.Id, token, journalResponse.Checkpoint);
        checkpointResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        await factory.WithDbContextAsync(async db =>
        {
            var m = await db.SpaceMembers.SingleAsync(m => m.Id == member.Id);
            m.LastSyncAt.Should().Be(journalResponse.Checkpoint);
        });
    }

    [Fact]
    public async Task DeleteCheckpoint_ClearsMemberLastSyncAt()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        await factory.WithDbContextAsync(async db =>
        {
            var trackedMember = await db.SpaceMembers.SingleAsync(m => m.Id == member.Id);
            trackedMember.LastSyncAt = DateTime.UtcNow.AddMinutes(-5);
            await db.SaveChangesAsync();
        });

        var response = await DeleteCheckpointAsync(client, space.Id, token);
        response.StatusCode.Should().Be(HttpStatusCode.NoContent);

        await factory.WithDbContextAsync(async db =>
        {
            var m = await db.SpaceMembers.SingleAsync(m => m.Id == member.Id);
            m.LastSyncAt.Should().BeNull();
        });
    }

    [Fact]
    public async Task GetJournal_ReplaysSameChanges_UntilCheckpointIsAcknowledged()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var item = await factory.CreateItemAsync(
            space.Id, member.Id,
            contentType: "text",
            content: "replay me",
            sharedAt: DateTime.UtcNow,
            fileSize: 0);

        var first = await ReadJsonAsync<JournalResponse>(await GetJournalAsync(client, space.Id, token));
        var second = await ReadJsonAsync<JournalResponse>(await GetJournalAsync(client, space.Id, token));

        first.AddedOrUpdated.Should().ContainSingle(r => r.Id == item.Id);
        second.AddedOrUpdated.Should().ContainSingle(r => r.Id == item.Id);
        second.Checkpoint.Should().BeOnOrAfter(first.Checkpoint);

        await factory.WithDbContextAsync(async db =>
        {
            var trackedMember = await db.SpaceMembers.SingleAsync(m => m.Id == member.Id);
            trackedMember.LastSyncAt.Should().Be(DateTime.SpecifyKind(DateTime.MinValue, DateTimeKind.Utc));
        });
    }

    [Fact]
    public async Task PostCheckpoint_StopsReplayingAcknowledgedItems()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var oldItem = await factory.CreateItemAsync(
            space.Id, member.Id,
            contentType: "text",
            content: "already synced",
            sharedAt: DateTime.UtcNow,
            fileSize: 0);

        var first = await ReadJsonAsync<JournalResponse>(await GetJournalAsync(client, space.Id, token));
        await PostCheckpointAsync(client, space.Id, token, first.Checkpoint);

        var newItem = await factory.CreateItemAsync(
            space.Id, member.Id,
            contentType: "text",
            content: "new after ack",
            sharedAt: first.Checkpoint.AddSeconds(1),
            fileSize: 0);

        var second = await ReadJsonAsync<JournalResponse>(await GetJournalAsync(client, space.Id, token));

        second.AddedOrUpdated.Should().ContainSingle(r => r.Id == newItem.Id);
        second.AddedOrUpdated.Should().NotContain(r => r.Id == oldItem.Id);
    }

    [Fact]
    public async Task DeleteCheckpoint_MakesNextGetReplayFullBaseline()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var item = await factory.CreateItemAsync(
            space.Id, member.Id,
            contentType: "text",
            content: "baseline item",
            sharedAt: DateTime.UtcNow.AddMinutes(-5),
            fileSize: 0);

        var initial = await ReadJsonAsync<JournalResponse>(await GetJournalAsync(client, space.Id, token));
        await PostCheckpointAsync(client, space.Id, token, initial.Checkpoint);

        var resetResponse = await DeleteCheckpointAsync(client, space.Id, token);
        resetResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var replay = await ReadJsonAsync<JournalResponse>(await GetJournalAsync(client, space.Id, token));
        replay.AddedOrUpdated.Should().ContainSingle(r => r.Id == item.Id);
    }

    [Fact]
    public async Task PostCheckpoint_DoesNotMoveStoredCheckpointBackward()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var currentCheckpoint = DateTime.UtcNow;
        var olderCheckpoint = currentCheckpoint.AddMinutes(-5);

        await factory.WithDbContextAsync(async db =>
        {
            var trackedMember = await db.SpaceMembers.SingleAsync(m => m.Id == member.Id);
            trackedMember.LastSyncAt = currentCheckpoint;
            await db.SaveChangesAsync();
        });

        var response = await PostCheckpointAsync(client, space.Id, token, olderCheckpoint);
        response.StatusCode.Should().Be(HttpStatusCode.NoContent);

        await factory.WithDbContextAsync(async db =>
        {
            var trackedMember = await db.SpaceMembers.SingleAsync(m => m.Id == member.Id);
            trackedMember.LastSyncAt.Should().Be(currentCheckpoint);
        });
    }

    [Fact]
    public async Task PostCheckpoint_WithDefaultCheckpoint_Returns400()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var response = await PostCheckpointAsync(client, space.Id, token, default);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task GetJournal_EmptyJournal_ReturnsEmptyArrays()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        await factory.WithDbContextAsync(async db =>
        {
            var trackedMember = await db.SpaceMembers.SingleAsync(m => m.Id == member.Id);
            trackedMember.LastSyncAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
        });

        var response = await GetJournalAsync(client, space.Id, token);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await ReadJsonAsync<JournalResponse>(response);
        body.FullSyncRequired.Should().BeFalse();
        body.AddedOrUpdated.Should().BeEmpty();
        body.Deleted.Should().BeEmpty();
    }

    [Fact]
    public async Task GetJournal_WithoutJwt_Returns401()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();

        var response = await GetJournalAsync(client, space.Id);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetJournal_NonExistentSpace_Returns404()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var nonExistentSpaceId = Guid.NewGuid();

        // Create a member in a real space but use the token for the non-existent space
        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, nonExistentSpaceId, member.DisplayName);

        var response = await GetJournalAsync(client, nonExistentSpaceId, token);

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task DeleteItem_CreatesDeletedItemRecord()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        // Opt member into journaling by calling journal endpoint
        await GetJournalAsync(client, space.Id, token);

        var item = await factory.CreateItemAsync(
            space.Id, member.Id,
            contentType: "text",
            content: "about to be deleted",
            sharedAt: DateTime.UtcNow,
            fileSize: 0);

        var deleteResponse = await DeleteItemAsync(client, space.Id, item.Id, token);
        deleteResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        await factory.WithDbContextAsync(async db =>
        {
            var deletedItem = await db.DeletedItems.SingleOrDefaultAsync(d => d.ItemId == item.Id);
            deletedItem.Should().NotBeNull();
            deletedItem!.SpaceId.Should().Be(space.Id);
            deletedItem.DeletedAt.Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromSeconds(5));
        });
    }

    [Fact]
    public async Task TransferItem_WithMoveAction_CreatesDeletedItemRecord()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        // Source space and member
        var sourceSpace = await factory.CreateSpaceAsync("Source");
        var sourceMember = await factory.CreateMemberAsync(sourceSpace.Id, "Zoe");
        var sourceToken = GenerateTestJwt(sourceMember.Id, sourceSpace.Id, sourceMember.DisplayName);

        // Opt source member into journaling
        await GetJournalAsync(client, sourceSpace.Id, sourceToken);

        // Destination space and member
        var destSpace = await factory.CreateSpaceAsync("Destination");
        var destMember = await factory.CreateMemberAsync(destSpace.Id, "Wash");
        var destToken = GenerateTestJwt(destMember.Id, destSpace.Id, destMember.DisplayName);

        var item = await factory.CreateItemAsync(
            sourceSpace.Id, sourceMember.Id,
            contentType: "text",
            content: "moving item",
            sharedAt: DateTime.UtcNow,
            fileSize: 0);

        var transferResponse = await TransferItemAsync(
            client, sourceSpace.Id, item.Id, sourceToken,
            destinationToken: destToken, action: "move");
        transferResponse.StatusCode.Should().Be(HttpStatusCode.Created);

        await factory.WithDbContextAsync(async db =>
        {
            var deletedItem = await db.DeletedItems.SingleOrDefaultAsync(d => d.ItemId == item.Id);
            deletedItem.Should().NotBeNull();
            deletedItem!.SpaceId.Should().Be(sourceSpace.Id);
        });
    }

    [Fact]
    public async Task Pruning_TrimsToConfiguredMaxAndUpdatesWatermark()
    {
        // Set max to 5 entries
        await using var factory = new TestWebApplicationFactory(journalMaxEntries: 5);
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        // Opt member into journaling
        await GetJournalAsync(client, space.Id, token);

        // Create 6 items to delete (will exceed the max of 5)
        var items = new List<SpaceItem>();
        for (var i = 0; i < 6; i++)
        {
            var item = await factory.CreateItemAsync(
                space.Id, member.Id,
                contentType: "text",
                content: $"item-{i}",
                sharedAt: DateTime.UtcNow.AddMinutes(-30 + i),
                fileSize: 0);
            items.Add(item);
        }

        // Delete all items — each deletion adds a DeletedItem record
        foreach (var item in items)
        {
            var deleteResponse = await DeleteItemAsync(client, space.Id, item.Id, token);
            deleteResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);
        }

        // After 6 deletions with max=5, pruning should have trimmed to 5
        await factory.WithDbContextAsync(async db =>
        {
            var deletedCount = await db.DeletedItems.CountAsync(d => d.SpaceId == space.Id);
            deletedCount.Should().BeLessOrEqualTo(5);

            var s = await db.Spaces.SingleAsync(s => s.Id == space.Id);
            s.JournalPrunedBefore.Should().NotBeNull();
        });
    }

    [Fact]
    public async Task DeleteItem_DoesNotCreateDeletedItemRecord_WhenNoMemberOptedIn()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        // Do NOT opt into journaling (no journal call)

        var item = await factory.CreateItemAsync(
            space.Id, member.Id,
            contentType: "text",
            content: "deleted without journal",
            sharedAt: DateTime.UtcNow,
            fileSize: 0);

        var deleteResponse = await DeleteItemAsync(client, space.Id, item.Id, token);
        deleteResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        await factory.WithDbContextAsync(async db =>
        {
            var deletedItem = await db.DeletedItems.SingleOrDefaultAsync(d => d.ItemId == item.Id);
            deletedItem.Should().BeNull();
        });
    }

    [Fact]
    public async Task GetJournal_WithoutCheckpoint_ReturnsAllItems()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var member = await factory.CreateMemberAsync(space.Id, "Zoe");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var item1 = await factory.CreateItemAsync(
            space.Id, member.Id,
            contentType: "text",
            content: "old item",
            sharedAt: DateTime.UtcNow.AddDays(-7),
            fileSize: 0);

        var item2 = await factory.CreateItemAsync(
            space.Id, member.Id,
            contentType: "text",
            content: "new item",
            sharedAt: DateTime.UtcNow,
            fileSize: 0);

        // No checkpoint yet -> should return everything
        var response = await GetJournalAsync(client, space.Id, token);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await ReadJsonAsync<JournalResponse>(response);
        body.AddedOrUpdated.Should().HaveCount(2);
        body.AddedOrUpdated.Should().Contain(r => r.Id == item1.Id);
        body.AddedOrUpdated.Should().Contain(r => r.Id == item2.Id);
    }

    // --- Helpers ---

    private static async Task<HttpResponseMessage> GetJournalAsync(
        HttpClient client, Guid spaceId, string? token = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"/v1/spaces/{spaceId}/journal");
        AddAuthorizationHeader(request, token);
        return await client.SendAsync(request);
    }

    private static async Task<HttpResponseMessage> PostCheckpointAsync(
        HttpClient client, Guid spaceId, string token, DateTime checkpoint)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"/v1/spaces/{spaceId}/journal/checkpoint");
        request.Content = JsonContent.Create(new { checkpoint });
        AddAuthorizationHeader(request, token);
        return await client.SendAsync(request);
    }

    private static async Task<HttpResponseMessage> DeleteCheckpointAsync(
        HttpClient client, Guid spaceId, string token)
    {
        using var request = new HttpRequestMessage(HttpMethod.Delete, $"/v1/spaces/{spaceId}/journal/checkpoint");
        AddAuthorizationHeader(request, token);
        return await client.SendAsync(request);
    }

    private static async Task<HttpResponseMessage> DeleteItemAsync(
        HttpClient client, Guid spaceId, Guid itemId, string? token = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Delete, $"/v1/spaces/{spaceId}/items/{itemId}");
        AddAuthorizationHeader(request, token);
        return await client.SendAsync(request);
    }

    private static async Task<HttpResponseMessage> TransferItemAsync(
        HttpClient client, Guid spaceId, Guid itemId, string sourceToken,
        string destinationToken, string action)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"/v1/spaces/{spaceId}/items/{itemId}/transfer");
        request.Content = JsonContent.Create(new { destinationToken, action });
        AddAuthorizationHeader(request, sourceToken);
        return await client.SendAsync(request);
    }

    private static void AddAuthorizationHeader(HttpRequestMessage request, string? token)
    {
        if (!string.IsNullOrWhiteSpace(token))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }
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

    private static async Task<T> ReadJsonAsync<T>(HttpResponseMessage response)
    {
        var body = await response.Content.ReadFromJsonAsync<T>();
        body.Should().NotBeNull();
        return body!;
    }

    private sealed record JournalResponse(
        bool FullSyncRequired,
        DateTime Checkpoint,
        SpaceItemResponse[] AddedOrUpdated,
        Guid[] Deleted);

    private sealed record SpaceItemResponse(
        Guid Id,
        Guid SpaceId,
        Guid MemberId,
        string ContentType,
        string Content,
        long FileSize,
        DateTime SharedAt);

    private sealed class TestWebApplicationFactory(long? maxSpaceQuotaBytes = null, int? journalMaxEntries = null) : WebApplicationFactory<Program>
    {
        public const string AdminSecret = "test-admin-secret";
        public const string JwtSigningKey = "test-signing-key-1234567890abcdef";
        public const string ServerUrl = "https://sharedspaces.test";

        private readonly string _databaseName = $"sharedspaces-journal-tests-{Guid.NewGuid()}";
        private readonly long _maxSpaceQuotaBytes = maxSpaceQuotaBytes ?? 104_857_600;

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");

            builder.ConfigureAppConfiguration((_, configBuilder) =>
            {
                var config = new Dictionary<string, string?>
                {
                    ["Admin:Secret"] = AdminSecret,
                    ["Jwt:SigningKey"] = JwtSigningKey,
                    ["Storage:BasePath"] = "./artifacts/storage-journal-tests",
                    ["Storage:MaxSpaceQuotaBytes"] = _maxSpaceQuotaBytes.ToString()
                };

                if (journalMaxEntries.HasValue)
                {
                    config["Journal:MaxEntriesPerSpace"] = journalMaxEntries.Value.ToString();
                }

                configBuilder.AddInMemoryCollection(config);
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
