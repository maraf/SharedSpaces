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
using SharedSpaces.Server.Infrastructure.Persistence;

namespace SharedSpaces.Server.Tests;

public class AdminEndpointTests
{
    // ========== Space Creation Tests ==========

    [Fact]
    public async Task CreateSpace_WithValidNameAndSecret_Returns201WithSpaceData()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var spaceName = "My Space";
        var response = await CreateSpaceAsync(client, spaceName, TestWebApplicationFactory.AdminSecret);

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var space = await ReadJsonAsync<SpaceResponse>(response);
        space.Should().NotBeNull();
        space!.Id.Should().NotBeEmpty();
        space.Name.Should().Be(spaceName);
        space.CreatedAt.Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromSeconds(5));

        var spaceInDb = await factory.WithDbContextAsync(db => db.Spaces.SingleOrDefaultAsync(s => s.Id == space.Id));
        spaceInDb.Should().NotBeNull();
        spaceInDb!.Name.Should().Be(spaceName);
    }

    [Fact]
    public async Task CreateSpace_WithMissingAdminSecret_Returns401()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var response = await CreateSpaceAsync(client, "My Space", adminSecret: null);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task CreateSpace_WithWrongAdminSecret_Returns401()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var response = await CreateSpaceAsync(client, "My Space", "wrong-secret");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task CreateSpace_WithEmptyName_Returns400()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var response = await CreateSpaceAsync(client, "", TestWebApplicationFactory.AdminSecret);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var error = await ReadJsonAsync<ErrorResponse>(response);
        error.Should().NotBeNull();
        error!.Error.Should().Contain("required");
    }

    [Fact]
    public async Task CreateSpace_WithWhitespaceOnlyName_Returns400()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var response = await CreateSpaceAsync(client, "   ", TestWebApplicationFactory.AdminSecret);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var error = await ReadJsonAsync<ErrorResponse>(response);
        error.Should().NotBeNull();
        error!.Error.Should().Contain("required");
    }

    [Fact]
    public async Task CreateSpace_WithVeryLongName_Returns400()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var veryLongName = new string('x', 201);
        var response = await CreateSpaceAsync(client, veryLongName, TestWebApplicationFactory.AdminSecret);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var error = await ReadJsonAsync<ErrorResponse>(response);
        error.Should().NotBeNull();
        error!.Error.Should().Contain("200 characters");
    }

    [Fact]
    public async Task CreateSpace_WithMaxLengthName_Returns201()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var maxLengthName = new string('x', 200);
        var response = await CreateSpaceAsync(client, maxLengthName, TestWebApplicationFactory.AdminSecret);

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var space = await ReadJsonAsync<SpaceResponse>(response);
        space.Should().NotBeNull();
        space!.Name.Should().Be(maxLengthName);
    }

    [Fact]
    public async Task CreateSpace_TrimsWhitespaceFromName()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var response = await CreateSpaceAsync(client, "  My Space  ", TestWebApplicationFactory.AdminSecret);

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var space = await ReadJsonAsync<SpaceResponse>(response);
        space.Should().NotBeNull();
        space!.Name.Should().Be("My Space");
    }

    // ========== Space Listing Tests ==========

    [Fact]
    public async Task ListSpaces_WithValidSecret_ReturnsAllSpaces()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var baseline = DateTime.UtcNow;
        var firstSpace = new Space { Id = Guid.NewGuid(), Name = "First Space", CreatedAt = baseline.AddMinutes(-2) };
        var secondSpace = new Space { Id = Guid.NewGuid(), Name = "Second Space", CreatedAt = baseline.AddMinutes(-1) };
        var thirdSpace = new Space { Id = Guid.NewGuid(), Name = "Third Space", CreatedAt = baseline };

        await factory.WithDbContextAsync(async db =>
        {
            db.Spaces.AddRange(firstSpace, secondSpace, thirdSpace);
            await db.SaveChangesAsync();
        });

        var response = await ListSpacesAsync(client, TestWebApplicationFactory.AdminSecret);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var spaces = await ReadJsonAsync<SpaceResponse[]>(response);
        spaces.Should().NotBeNull();
        var actualSpaces = spaces!;
        actualSpaces.Should().HaveCount(3);
        actualSpaces.Should().OnlyContain(space => space.CreatedAt != default);
        actualSpaces.Select(space => space.Id).Should().Equal(thirdSpace.Id, secondSpace.Id, firstSpace.Id);
        actualSpaces.Select(space => space.Name).Should().Equal("Third Space", "Second Space", "First Space");
    }

    [Fact]
    public async Task ListSpaces_WithInvalidSecret_Returns401()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var response = await ListSpacesAsync(client, "wrong-secret");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task ListSpaces_WhenEmpty_ReturnsEmptyArray()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var response = await ListSpacesAsync(client, TestWebApplicationFactory.AdminSecret);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var spaces = await ReadJsonAsync<SpaceResponse[]>(response);
        spaces.Should().NotBeNull();
        spaces!.Should().BeEmpty();
    }

    // ========== Invitation Generation Tests ==========

    [Fact]
    public async Task CreateInvitation_WithValidSpaceAndSecret_Returns200WithInvitationAndQrCode()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync("Launch Room");
        var response = await CreateInvitationAsync(
            client,
            space.Id,
            clientAppUrl: null,
            TestWebApplicationFactory.AdminSecret);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var invitation = await ReadJsonAsync<InvitationResponse>(response);
        invitation.Should().NotBeNull();
        invitation!.InvitationString.Should().NotBeNullOrWhiteSpace();
        invitation.QrCodeBase64.Should().NotBeNullOrWhiteSpace();

        var parts = invitation.InvitationString.Split('|');
        parts.Should().HaveCount(3);
        parts[0].Should().Be(TestWebApplicationFactory.ServerUrl);
        parts[1].Should().Be(space.Id.ToString());
        parts[2].Should().MatchRegex(@"^\d{6}$");
    }

    [Fact]
    public async Task CreateInvitation_WithCustomClientAppUrl_ReturnsInvitationStringAndQrCode()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync("Custom Space");
        var customClientUrl = "https://custom.app";
        var response = await CreateInvitationAsync(
            client,
            space.Id,
            customClientUrl,
            TestWebApplicationFactory.AdminSecret);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var invitation = await ReadJsonAsync<InvitationResponse>(response);
        invitation.Should().NotBeNull();
        invitation!.QrCodeBase64.Should().NotBeNullOrWhiteSpace();

        var parts = invitation.InvitationString.Split('|');
        parts.Should().HaveCount(3);
        parts[0].Should().Be(TestWebApplicationFactory.ServerUrl);
        parts[1].Should().Be(space.Id.ToString());
        parts[2].Should().MatchRegex(@"^\d{6}$");
    }

    [Fact]
    public async Task CreateInvitation_WithoutClientAppUrl_UsesServerDefaultInQrCode()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync("Default Space");
        var response = await CreateInvitationAsync(
            client,
            space.Id,
            clientAppUrl: null,
            TestWebApplicationFactory.AdminSecret);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var invitation = await ReadJsonAsync<InvitationResponse>(response);
        invitation.Should().NotBeNull();
        invitation!.QrCodeBase64.Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task CreateInvitation_WithMissingAdminSecret_Returns401()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var response = await CreateInvitationAsync(
            client,
            space.Id,
            clientAppUrl: null,
            adminSecret: null);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task CreateInvitation_WithWrongAdminSecret_Returns401()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var response = await CreateInvitationAsync(
            client,
            space.Id,
            clientAppUrl: null,
            "wrong-secret");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task CreateInvitation_WithNonExistentSpace_Returns404()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var nonExistentSpaceId = Guid.NewGuid();
        var response = await CreateInvitationAsync(
            client,
            nonExistentSpaceId,
            clientAppUrl: null,
            TestWebApplicationFactory.AdminSecret);

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        var error = await ReadJsonAsync<ErrorResponse>(response);
        error.Should().NotBeNull();
        error!.Error.Should().Contain("not found");
    }

    [Fact]
    public async Task CreateInvitation_QrCodeIsValidBase64ImageData()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var response = await CreateInvitationAsync(
            client,
            space.Id,
            clientAppUrl: null,
            TestWebApplicationFactory.AdminSecret);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var invitation = await ReadJsonAsync<InvitationResponse>(response);
        invitation.Should().NotBeNull();
        invitation!.QrCodeBase64.Should().NotBeNullOrWhiteSpace();

        var imageBytes = Convert.FromBase64String(invitation.QrCodeBase64!);
        imageBytes.Should().NotBeEmpty();
        
        imageBytes[0].Should().Be(0x89);
        imageBytes[1].Should().Be(0x50);
        imageBytes[2].Should().Be(0x4E);
        imageBytes[3].Should().Be(0x47);
    }

    [Fact]
    public async Task CreateInvitation_InvitationStringFormatIsCorrect()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var response = await CreateInvitationAsync(
            client,
            space.Id,
            clientAppUrl: null,
            TestWebApplicationFactory.AdminSecret);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var invitation = await ReadJsonAsync<InvitationResponse>(response);
        invitation.Should().NotBeNull();

        var parts = invitation!.InvitationString.Split('|');
        parts.Should().HaveCount(3, "invitation string should have format: server_url|space_id|pin");
        
        parts[0].Should().Be(TestWebApplicationFactory.ServerUrl, "first part should be server URL");
        Guid.TryParse(parts[1], out var spaceId).Should().BeTrue("second part should be valid GUID");
        spaceId.Should().Be(space.Id, "second part should be the space ID");
        parts[2].Should().MatchRegex(@"^\d{6}$", "third part should be 6-digit PIN");
    }

    [Fact]
    public async Task CreateInvitation_StoresHashedPinInDatabase()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        var response = await CreateInvitationAsync(
            client,
            space.Id,
            clientAppUrl: null,
            TestWebApplicationFactory.AdminSecret);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var invitation = await ReadJsonAsync<InvitationResponse>(response);
        var pin = invitation!.InvitationString.Split('|')[2];

        var invitationInDb = await factory.WithDbContextAsync(db => 
            db.SpaceInvitations.SingleOrDefaultAsync(i => i.SpaceId == space.Id));
        
        invitationInDb.Should().NotBeNull();
        invitationInDb!.Pin.Should().NotBe(pin, "PIN should be hashed in database");
        invitationInDb.Pin.Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task CreateInvitation_MultipleInvitationsForSameSpace_EachHasUniquePinAndQrCode()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync();
        
        var response1 = await CreateInvitationAsync(client, space.Id, null, TestWebApplicationFactory.AdminSecret);
        var response2 = await CreateInvitationAsync(client, space.Id, null, TestWebApplicationFactory.AdminSecret);

        response1.StatusCode.Should().Be(HttpStatusCode.OK);
        response2.StatusCode.Should().Be(HttpStatusCode.OK);

        var invitation1 = await ReadJsonAsync<InvitationResponse>(response1);
        var invitation2 = await ReadJsonAsync<InvitationResponse>(response2);

        invitation1!.InvitationString.Should().NotBe(invitation2!.InvitationString);
        invitation1.QrCodeBase64.Should().NotBe(invitation2.QrCodeBase64);

        var pin1 = invitation1.InvitationString.Split('|')[2];
        var pin2 = invitation2.InvitationString.Split('|')[2];
        pin1.Should().NotBe(pin2);
    }

    // ========== Member Management Tests ==========

    [Fact]
    public async Task ListMembers_WithValidSecret_ReturnsMembers()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await CreateSpaceViaAdminAsync(client, "Team Space");
        var firstMember = await CreateMemberViaTokenExchangeAsync(factory, client, space.Id, "Taylor");
        var secondMember = await CreateMemberViaTokenExchangeAsync(factory, client, space.Id, "Jordan");

        var response = await ListMembersAsync(client, space.Id, TestWebApplicationFactory.AdminSecret);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var members = await ReadJsonAsync<MemberResponse[]>(response);
        members.Should().NotBeNull();
        members!.Should().HaveCount(2);
        members.Select(member => member.Id).Should().BeEquivalentTo([firstMember.Id, secondMember.Id]);
        members.Select(member => member.DisplayName).Should().BeEquivalentTo(["Taylor", "Jordan"]);
        members.Should().OnlyContain(member => !member.IsRevoked && member.JoinedAt != default);
    }

    [Fact]
    public async Task ListMembers_WithInvalidSecret_Returns401()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync("Team Space");

        var response = await ListMembersAsync(client, space.Id, "wrong-secret");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task ListMembers_ForNonexistentSpace_Returns404()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var response = await ListMembersAsync(client, Guid.NewGuid(), TestWebApplicationFactory.AdminSecret);

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        var error = await ReadJsonAsync<ErrorResponse>(response);
        error.Should().NotBeNull();
        error!.Error.Should().Contain("Space not found");
    }

    [Fact]
    public async Task ListMembers_EmptySpace_ReturnsEmptyArray()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await CreateSpaceViaAdminAsync(client, "Empty Space");

        var response = await ListMembersAsync(client, space.Id, TestWebApplicationFactory.AdminSecret);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var members = await ReadJsonAsync<MemberResponse[]>(response);
        members.Should().NotBeNull();
        members!.Should().BeEmpty();
    }

    [Fact]
    public async Task RevokeMember_WithValidSecret_SetsMemberRevoked()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await CreateSpaceViaAdminAsync(client, "Team Space");
        var member = await CreateMemberViaTokenExchangeAsync(factory, client, space.Id, "Taylor");

        var revokeResponse = await RevokeMemberAsync(client, space.Id, member.Id, TestWebApplicationFactory.AdminSecret);

        revokeResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var listResponse = await ListMembersAsync(client, space.Id, TestWebApplicationFactory.AdminSecret);
        listResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var members = await ReadJsonAsync<MemberResponse[]>(listResponse);
        members.Should().NotBeNull();
        members!.Should().ContainSingle(existingMember => existingMember.Id == member.Id && existingMember.IsRevoked);
    }

    [Fact]
    public async Task RevokeMember_WithInvalidSecret_Returns401()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await CreateSpaceViaAdminAsync(client, "Team Space");
        var member = await CreateMemberViaTokenExchangeAsync(factory, client, space.Id, "Taylor");

        var response = await RevokeMemberAsync(client, space.Id, member.Id, "wrong-secret");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task RevokeMember_NonexistentMember_Returns404()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync("Team Space");

        var response = await RevokeMemberAsync(client, space.Id, Guid.NewGuid(), TestWebApplicationFactory.AdminSecret);

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        var error = await ReadJsonAsync<ErrorResponse>(response);
        error.Should().NotBeNull();
        error!.Error.Should().Contain("Member not found");
    }

    [Fact]
    public async Task RevokeMember_AlreadyRevoked_Returns204()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await CreateSpaceViaAdminAsync(client, "Team Space");
        var member = await CreateMemberViaTokenExchangeAsync(factory, client, space.Id, "Taylor");

        var firstResponse = await RevokeMemberAsync(client, space.Id, member.Id, TestWebApplicationFactory.AdminSecret);
        firstResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var secondResponse = await RevokeMemberAsync(client, space.Id, member.Id, TestWebApplicationFactory.AdminSecret);
        secondResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);
    }

    // ========== Invitation Management Tests ==========

    [Fact]
    public async Task ListInvitations_WithValidSecret_ReturnsInvitations()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await CreateSpaceViaAdminAsync(client, "Team Space");
        await CreateInvitationViaAdminAsync(client, space.Id);
        await CreateInvitationViaAdminAsync(client, space.Id);
        var expectedInvitationIds = await factory.WithDbContextAsync(async db => await db.SpaceInvitations
            .Where(invitation => invitation.SpaceId == space.Id)
            .Select(invitation => invitation.Id)
            .ToArrayAsync());

        var response = await ListInvitationsAsync(client, space.Id, TestWebApplicationFactory.AdminSecret);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var responseContent = await response.Content.ReadAsStringAsync();
        var invitations = JsonSerializer.Deserialize<InvitationListResponse[]>(responseContent, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        invitations.Should().NotBeNull();
        invitations!.Should().HaveCount(2);
        invitations.Select(invitation => invitation.Id).Should().BeEquivalentTo(expectedInvitationIds);
        invitations.Select(invitation => invitation.SpaceId).Should().OnlyContain(spaceId => spaceId == space.Id);

        using var payload = JsonDocument.Parse(responseContent);
        payload.RootElement.EnumerateArray().Any(item => item.TryGetProperty("pin", out _)).Should().BeFalse();
    }

    [Fact]
    public async Task ListInvitations_WithInvalidSecret_Returns401()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync("Team Space");

        var response = await ListInvitationsAsync(client, space.Id, "wrong-secret");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task ListInvitations_EmptySpace_ReturnsEmptyArray()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await CreateSpaceViaAdminAsync(client, "Empty Space");

        var response = await ListInvitationsAsync(client, space.Id, TestWebApplicationFactory.AdminSecret);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var invitations = await ReadJsonAsync<InvitationListResponse[]>(response);
        invitations.Should().NotBeNull();
        invitations!.Should().BeEmpty();
    }

    [Fact]
    public async Task ListInvitations_WithMissingSpace_Returns404()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var response = await ListInvitationsAsync(client, Guid.NewGuid(), TestWebApplicationFactory.AdminSecret);

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        var error = await ReadJsonAsync<ErrorResponse>(response);
        error.Should().NotBeNull();
        error!.Error.Should().Contain("Space not found");
    }

    [Fact]
    public async Task DeleteInvitation_WithValidSecret_RemovesInvitation()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await CreateSpaceViaAdminAsync(client, "Team Space");
        await CreateInvitationViaAdminAsync(client, space.Id);
        var invitationId = await factory.WithDbContextAsync(async db => await db.SpaceInvitations
            .Where(invitation => invitation.SpaceId == space.Id)
            .Select(invitation => invitation.Id)
            .SingleAsync());

        var deleteResponse = await DeleteInvitationAsync(client, space.Id, invitationId, TestWebApplicationFactory.AdminSecret);

        deleteResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var listResponse = await ListInvitationsAsync(client, space.Id, TestWebApplicationFactory.AdminSecret);
        listResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var invitations = await ReadJsonAsync<InvitationListResponse[]>(listResponse);
        invitations.Should().NotBeNull();
        invitations!.Should().BeEmpty();
    }

    [Fact]
    public async Task DeleteInvitation_WithInvalidSecret_Returns401()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await CreateSpaceViaAdminAsync(client, "Team Space");
        await CreateInvitationViaAdminAsync(client, space.Id);
        var invitationId = await factory.WithDbContextAsync(async db => await db.SpaceInvitations
            .Where(invitation => invitation.SpaceId == space.Id)
            .Select(invitation => invitation.Id)
            .SingleAsync());

        var response = await DeleteInvitationAsync(client, space.Id, invitationId, "wrong-secret");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task DeleteInvitation_NonexistentInvitation_Returns404()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await factory.CreateSpaceAsync("Team Space");

        var response = await DeleteInvitationAsync(client, space.Id, Guid.NewGuid(), TestWebApplicationFactory.AdminSecret);

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        var error = await ReadJsonAsync<ErrorResponse>(response);
        error.Should().NotBeNull();
        error!.Error.Should().Contain("Invitation not found");
    }

    // ========== Helper Methods ==========

    private static async Task<HttpResponseMessage> CreateSpaceAsync(
        HttpClient client,
        string name,
        string? adminSecret)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/v1/spaces");
        if (!string.IsNullOrWhiteSpace(adminSecret))
        {
            request.Headers.Add("X-Admin-Secret", adminSecret);
        }
        request.Content = JsonContent.Create(new CreateSpaceRequest(name));
        return await client.SendAsync(request);
    }

    private static async Task<HttpResponseMessage> CreateInvitationAsync(
        HttpClient client,
        Guid spaceId,
        string? clientAppUrl,
        string? adminSecret)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"/v1/spaces/{spaceId}/invitations");
        if (!string.IsNullOrWhiteSpace(adminSecret))
        {
            request.Headers.Add("X-Admin-Secret", adminSecret);
        }
        request.Content = JsonContent.Create(new CreateInvitationRequest(clientAppUrl));
        return await client.SendAsync(request);
    }

    private static async Task<HttpResponseMessage> ListMembersAsync(
        HttpClient client,
        Guid spaceId,
        string? adminSecret)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"/v1/spaces/{spaceId}/members");
        if (!string.IsNullOrWhiteSpace(adminSecret))
        {
            request.Headers.Add("X-Admin-Secret", adminSecret);
        }

        return await client.SendAsync(request);
    }

    private static async Task<HttpResponseMessage> RevokeMemberAsync(
        HttpClient client,
        Guid spaceId,
        Guid memberId,
        string? adminSecret)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"/v1/spaces/{spaceId}/members/{memberId}/revoke");
        if (!string.IsNullOrWhiteSpace(adminSecret))
        {
            request.Headers.Add("X-Admin-Secret", adminSecret);
        }

        return await client.SendAsync(request);
    }

    private static async Task<HttpResponseMessage> ListInvitationsAsync(
        HttpClient client,
        Guid spaceId,
        string? adminSecret)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"/v1/spaces/{spaceId}/invitations");
        if (!string.IsNullOrWhiteSpace(adminSecret))
        {
            request.Headers.Add("X-Admin-Secret", adminSecret);
        }

        return await client.SendAsync(request);
    }

    private static async Task<HttpResponseMessage> DeleteInvitationAsync(
        HttpClient client,
        Guid spaceId,
        Guid invitationId,
        string? adminSecret)
    {
        using var request = new HttpRequestMessage(HttpMethod.Delete, $"/v1/spaces/{spaceId}/invitations/{invitationId}");
        if (!string.IsNullOrWhiteSpace(adminSecret))
        {
            request.Headers.Add("X-Admin-Secret", adminSecret);
        }

        return await client.SendAsync(request);
    }

    private static async Task<HttpResponseMessage> ListSpacesAsync(
        HttpClient client,
        string? adminSecret)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/v1/spaces");
        if (!string.IsNullOrWhiteSpace(adminSecret))
        {
            request.Headers.Add("X-Admin-Secret", adminSecret);
        }

        return await client.SendAsync(request);
    }

    private static async Task<T?> ReadJsonAsync<T>(HttpResponseMessage response)
    {
        return await response.Content.ReadFromJsonAsync<T>();
    }

    // ========== DTOs ==========

    private sealed record CreateSpaceRequest(string Name);

    private sealed record SpaceResponse(Guid Id, string Name, DateTime CreatedAt);

    private sealed record CreateInvitationRequest(string? ClientAppUrl);

    private sealed record InvitationResponse(string InvitationString, string? QrCodeBase64);

    private sealed record MemberResponse(Guid Id, string DisplayName, DateTime JoinedAt, bool IsRevoked);

    private sealed record InvitationListResponse(Guid Id, Guid SpaceId);

    private sealed record ErrorResponse(string Error);

    // ========== Test Infrastructure ==========

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
                    ["Server:Url"] = ServerUrl,
                    ["Server:DefaultClientAppUrl"] = "https://localhost:5173",
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
