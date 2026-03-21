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
using Microsoft.IdentityModel.Tokens;
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

    // ========== Space Creation Quota Tests ==========

    [Fact]
    public async Task CreateSpace_WithMaxUploadSize_Returns201WithQuotaFields()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var response = await CreateSpaceAsync(client, "Quota Space", TestWebApplicationFactory.AdminSecret, maxUploadSize: 50_000_000);

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var space = await ReadJsonAsync<SpaceResponse>(response);
        space.Should().NotBeNull();
        space!.MaxUploadSize.Should().Be(50_000_000);
        space.EffectiveMaxUploadSize.Should().Be(50_000_000);
    }

    [Fact]
    public async Task CreateSpace_WithoutMaxUploadSize_ReturnsServerDefaultAsEffective()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var response = await CreateSpaceAsync(client, "Default Quota Space", TestWebApplicationFactory.AdminSecret);

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var space = await ReadJsonAsync<SpaceResponse>(response);
        space.Should().NotBeNull();
        space!.MaxUploadSize.Should().BeNull();
        space.EffectiveMaxUploadSize.Should().Be(104_857_600);
    }

    [Fact]
    public async Task CreateSpace_WithMaxUploadSizeExceedingServerLimit_Returns400()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var response = await CreateSpaceAsync(client, "Over Limit Space", TestWebApplicationFactory.AdminSecret, maxUploadSize: 200_000_000);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var error = await ReadJsonAsync<ErrorResponse>(response);
        error.Should().NotBeNull();
        error!.Error.Should().Contain("must not exceed server limit");
    }

    [Fact]
    public async Task CreateSpace_WithZeroMaxUploadSize_Returns400()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var response = await CreateSpaceAsync(client, "Zero Quota Space", TestWebApplicationFactory.AdminSecret, maxUploadSize: 0);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var error = await ReadJsonAsync<ErrorResponse>(response);
        error.Should().NotBeNull();
        error!.Error.Should().Contain("greater than 0");
    }

    [Fact]
    public async Task CreateSpace_WithNegativeMaxUploadSize_Returns400()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var response = await CreateSpaceAsync(client, "Negative Quota Space", TestWebApplicationFactory.AdminSecret, maxUploadSize: -100);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var error = await ReadJsonAsync<ErrorResponse>(response);
        error.Should().NotBeNull();
        error!.Error.Should().Contain("greater than 0");
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

    [Fact]
    public async Task ListSpaces_IncludesQuotaFields()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var spaceWithQuota = new Space { Id = Guid.NewGuid(), Name = "Quota Space", MaxUploadSize = 50_000_000 };
        var spaceWithoutQuota = new Space { Id = Guid.NewGuid(), Name = "Default Space" };
        await factory.WithDbContextAsync(async db =>
        {
            db.Spaces.AddRange(spaceWithQuota, spaceWithoutQuota);
            await db.SaveChangesAsync();
        });

        var response = await ListSpacesAsync(client, TestWebApplicationFactory.AdminSecret);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var spaces = await ReadJsonAsync<SpaceResponse[]>(response);
        spaces.Should().NotBeNull();
        var actualSpaces = spaces!;
        actualSpaces.Should().HaveCount(2);

        var quotaSpace = actualSpaces.Single(s => s.Id == spaceWithQuota.Id);
        quotaSpace.MaxUploadSize.Should().Be(50_000_000);
        quotaSpace.EffectiveMaxUploadSize.Should().Be(50_000_000);

        var defaultSpace = actualSpaces.Single(s => s.Id == spaceWithoutQuota.Id);
        defaultSpace.MaxUploadSize.Should().BeNull();
        defaultSpace.EffectiveMaxUploadSize.Should().Be(104_857_600);
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
            clientAppUrl: "https://localhost:5173",
            TestWebApplicationFactory.AdminSecret);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var invitation = await ReadJsonAsync<InvitationResponse>(response);
        invitation.Should().NotBeNull();
        invitation!.InvitationString.Should().NotBeNullOrWhiteSpace();
        invitation.QrCodeBase64.Should().NotBeNullOrWhiteSpace();

        var parts = invitation.InvitationString.Split('|');
        parts.Should().HaveCount(3);
        parts[0].Should().Be("http://localhost");
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
        parts[0].Should().Be("http://localhost");
        parts[1].Should().Be(space.Id.ToString());
        parts[2].Should().MatchRegex(@"^\d{6}$");
    }

    [Fact]
    public async Task CreateInvitation_WithoutClientAppUrl_ReturnsNullQrCode()
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
        invitation!.InvitationString.Should().NotBeNullOrWhiteSpace();
        invitation.QrCodeBase64.Should().BeNull();
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
            clientAppUrl: "https://localhost:5173",
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
        
        parts[0].Should().Be("http://localhost", "first part should be server URL");
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
        
        var response1 = await CreateInvitationAsync(client, space.Id, "https://localhost:5173", TestWebApplicationFactory.AdminSecret);
        var response2 = await CreateInvitationAsync(client, space.Id, "https://localhost:5173", TestWebApplicationFactory.AdminSecret);

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
        var actualMembers = members!;
        actualMembers.Should().HaveCount(2);
        actualMembers.Select(member => member.Id).Should().BeEquivalentTo([firstMember.Id, secondMember.Id]);
        actualMembers.Select(member => member.DisplayName).Should().BeEquivalentTo(["Taylor", "Jordan"]);
        actualMembers.Should().OnlyContain(member => !member.IsRevoked && member.JoinedAt != default);
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

    [Fact]
    public async Task RemoveMember_RevokedMemberWithItems_ReturnsNoContentAndDeletesMemberAndItems()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await CreateSpaceViaAdminAsync(client, "Team Space");
        var member = await CreateMemberViaTokenExchangeAsync(factory, client, space.Id, "Taylor");
        var token = GenerateTestJwt(member.Id, space.Id, member.DisplayName);

        var textItemId = Guid.NewGuid();
        var textResponse = await UpsertTextItemAsync(client, space.Id, textItemId, "member text", token);
        textResponse.StatusCode.Should().Be(HttpStatusCode.Created);

        var fileItemId = Guid.NewGuid();
        var fileBytes = Enumerable.Repeat((byte)'x', 100).ToArray();
        var fileResponse = await UpsertFileItemAsync(client, space.Id, fileItemId, fileBytes, "test.bin", token);
        fileResponse.StatusCode.Should().Be(HttpStatusCode.Created);

        var revokeResponse = await RevokeMemberAsync(client, space.Id, member.Id, TestWebApplicationFactory.AdminSecret);
        revokeResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var removeResponse = await RemoveMemberAsync(client, space.Id, member.Id, TestWebApplicationFactory.AdminSecret);

        removeResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var listMembersResponse = await ListMembersAsync(client, space.Id, TestWebApplicationFactory.AdminSecret);
        var members = await ReadJsonAsync<MemberResponse[]>(listMembersResponse);
        members.Should().NotContain(m => m.Id == member.Id);

        var listItemsResponse = await ListItemsAsync(client, space.Id, token);
        listItemsResponse.StatusCode.Should().BeOneOf(HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden);

        var memberExists = await factory.WithDbContextAsync(db => db.SpaceMembers.AnyAsync(m => m.Id == member.Id));
        memberExists.Should().BeFalse();

        var itemsExist = await factory.WithDbContextAsync(db => db.SpaceItems.AnyAsync(item => item.MemberId == member.Id));
        itemsExist.Should().BeFalse();
    }

    [Fact]
    public async Task RemoveMember_RevokedMemberWithoutItems_ReturnsNoContent()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await CreateSpaceViaAdminAsync(client, "Team Space");
        var member = await CreateMemberViaTokenExchangeAsync(factory, client, space.Id, "Taylor");

        var revokeResponse = await RevokeMemberAsync(client, space.Id, member.Id, TestWebApplicationFactory.AdminSecret);
        revokeResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var removeResponse = await RemoveMemberAsync(client, space.Id, member.Id, TestWebApplicationFactory.AdminSecret);

        removeResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var listMembersResponse = await ListMembersAsync(client, space.Id, TestWebApplicationFactory.AdminSecret);
        var members = await ReadJsonAsync<MemberResponse[]>(listMembersResponse);
        members.Should().NotContain(m => m.Id == member.Id);

        var memberExists = await factory.WithDbContextAsync(db => db.SpaceMembers.AnyAsync(m => m.Id == member.Id));
        memberExists.Should().BeFalse();
    }

    [Fact]
    public async Task RemoveMember_NonRevokedMember_ReturnsConflict()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await CreateSpaceViaAdminAsync(client, "Team Space");
        var member = await CreateMemberViaTokenExchangeAsync(factory, client, space.Id, "Taylor");

        var removeResponse = await RemoveMemberAsync(client, space.Id, member.Id, TestWebApplicationFactory.AdminSecret);

        removeResponse.StatusCode.Should().Be(HttpStatusCode.Conflict);
        var error = await ReadJsonAsync<ErrorResponse>(removeResponse);
        error.Should().NotBeNull();

        var memberExists = await factory.WithDbContextAsync(db => db.SpaceMembers.AnyAsync(m => m.Id == member.Id));
        memberExists.Should().BeTrue();
    }

    [Fact]
    public async Task RemoveMember_MemberNotFound_ReturnsNotFound()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await CreateSpaceViaAdminAsync(client, "Team Space");

        var removeResponse = await RemoveMemberAsync(client, space.Id, Guid.NewGuid(), TestWebApplicationFactory.AdminSecret);

        removeResponse.StatusCode.Should().Be(HttpStatusCode.NotFound);
        var error = await ReadJsonAsync<ErrorResponse>(removeResponse);
        error.Should().NotBeNull();
    }

    [Fact]
    public async Task RemoveMember_SpaceNotFound_ReturnsNotFound()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var removeResponse = await RemoveMemberAsync(client, Guid.NewGuid(), Guid.NewGuid(), TestWebApplicationFactory.AdminSecret);

        removeResponse.StatusCode.Should().Be(HttpStatusCode.NotFound);
        var error = await ReadJsonAsync<ErrorResponse>(removeResponse);
        error.Should().NotBeNull();
    }

    [Fact]
    public async Task RemoveMember_MissingAdminSecret_ReturnsUnauthorized()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var space = await CreateSpaceViaAdminAsync(client, "Team Space");
        var member = await CreateMemberViaTokenExchangeAsync(factory, client, space.Id, "Taylor");

        var revokeResponse = await RevokeMemberAsync(client, space.Id, member.Id, TestWebApplicationFactory.AdminSecret);
        revokeResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var removeResponse = await RemoveMemberAsync(client, space.Id, member.Id, adminSecret: null);

        removeResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        var memberExists = await factory.WithDbContextAsync(db => db.SpaceMembers.AnyAsync(m => m.Id == member.Id));
        memberExists.Should().BeTrue();
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
        var actualInvitations = invitations!;
        actualInvitations.Should().HaveCount(2);
        actualInvitations.Select(invitation => invitation.Id).Should().BeEquivalentTo(expectedInvitationIds);
        actualInvitations.Select(invitation => invitation.SpaceId).Should().OnlyContain(spaceId => spaceId == space.Id);

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

    [Fact]
    public async Task DeleteInvitation_WithMissingSpace_Returns404()
    {
        await using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        var response = await DeleteInvitationAsync(client, Guid.NewGuid(), Guid.NewGuid(), TestWebApplicationFactory.AdminSecret);

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        var error = await ReadJsonAsync<ErrorResponse>(response);
        error.Should().NotBeNull();
        error!.Error.Should().Contain("Space not found");
    }

    // ========== Helper Methods ==========

    private static async Task<HttpResponseMessage> CreateSpaceAsync(
        HttpClient client,
        string name,
        string? adminSecret,
        long? maxUploadSize = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/v1/spaces");
        if (!string.IsNullOrWhiteSpace(adminSecret))
        {
            request.Headers.Add("X-Admin-Secret", adminSecret);
        }
        request.Content = JsonContent.Create(new CreateSpaceRequest(name, maxUploadSize));
        return await client.SendAsync(request);
    }

    private static async Task<HttpResponseMessage> CreateInvitationAsync(
        HttpClient client,
        Guid spaceId,
        string? clientAppUrl,
        string? adminSecret,
        string? origin = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"/v1/spaces/{spaceId}/invitations");
        if (!string.IsNullOrWhiteSpace(adminSecret))
        {
            request.Headers.Add("X-Admin-Secret", adminSecret);
        }
        if (!string.IsNullOrWhiteSpace(origin))
        {
            request.Headers.Add("Origin", origin);
        }
        request.Content = JsonContent.Create(new CreateInvitationRequest(clientAppUrl));
        return await client.SendAsync(request);
    }

    private static Task<HttpResponseMessage> ExchangeTokenAsync(
        HttpClient client,
        Guid spaceId,
        string pin,
        string displayName)
    {
        return client.PostAsJsonAsync($"/v1/spaces/{spaceId}/tokens", new ExchangeTokenRequest(pin, displayName));
    }

    private static async Task<SpaceResponse> CreateSpaceViaAdminAsync(HttpClient client, string name)
    {
        var response = await CreateSpaceAsync(client, name, TestWebApplicationFactory.AdminSecret);
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var space = await ReadJsonAsync<SpaceResponse>(response);
        space.Should().NotBeNull();
        return space!;
    }

    private static async Task<InvitationResponse> CreateInvitationViaAdminAsync(
        HttpClient client,
        Guid spaceId,
        string? clientAppUrl = null)
    {
        var response = await CreateInvitationAsync(client, spaceId, clientAppUrl, TestWebApplicationFactory.AdminSecret);
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var invitation = await ReadJsonAsync<InvitationResponse>(response);
        invitation.Should().NotBeNull();
        return invitation!;
    }

    private static async Task<SpaceMember> CreateMemberViaTokenExchangeAsync(
        TestWebApplicationFactory factory,
        HttpClient client,
        Guid spaceId,
        string displayName)
    {
        var invitation = await CreateInvitationViaAdminAsync(client, spaceId);
        var pin = ExtractPin(invitation.InvitationString);

        var tokenResponse = await ExchangeTokenAsync(client, spaceId, pin, displayName);
        tokenResponse.StatusCode.Should().Be(HttpStatusCode.OK);

        return await factory.WithDbContextAsync(db => db.SpaceMembers.SingleAsync(member => member.SpaceId == spaceId && member.DisplayName == displayName));
    }

    private static string ExtractPin(string invitationString)
    {
        var parts = invitationString.Split('|');
        parts.Should().HaveCount(3);
        return parts[2];
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

    private static async Task<HttpResponseMessage> RemoveMemberAsync(
        HttpClient client,
        Guid spaceId,
        Guid memberId,
        string? adminSecret)
    {
        using var request = new HttpRequestMessage(HttpMethod.Delete, $"/v1/spaces/{spaceId}/members/{memberId}");
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

    private static string GenerateTestJwt(Guid memberId, Guid spaceId, string displayName)
    {
        var claims = new[]
        {
            new Claim("sub", memberId.ToString()),
            new Claim("display_name", displayName),
            new Claim("space_id", spaceId.ToString()),
            new Claim("server_url", TestWebApplicationFactory.ServerUrl)
        };

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(TestWebApplicationFactory.JwtSigningKey));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            claims: claims,
            signingCredentials: creds
        );

        var tokenHandler = new JwtSecurityTokenHandler();
        return tokenHandler.WriteToken(token);
    }

    private static async Task<HttpResponseMessage> UpsertTextItemAsync(
        HttpClient client,
        Guid spaceId,
        Guid itemId,
        string content,
        string? token = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Put, $"/v1/spaces/{spaceId}/items/{itemId}");
        using var form = new MultipartFormDataContent();

        form.Add(new StringContent(itemId.ToString()), "id");
        form.Add(new StringContent("text"), "contentType");
        form.Add(new StringContent(content), "content");
        request.Content = form;

        if (!string.IsNullOrWhiteSpace(token))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }
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

        if (!string.IsNullOrWhiteSpace(token))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }
        return await client.SendAsync(request);
    }

    private static async Task<HttpResponseMessage> ListItemsAsync(
        HttpClient client,
        Guid spaceId,
        string? token = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"/v1/spaces/{spaceId}/items");
        if (!string.IsNullOrWhiteSpace(token))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }
        return await client.SendAsync(request);
    }

    private static async Task<T?> ReadJsonAsync<T>(HttpResponseMessage response)
    {
        return await response.Content.ReadFromJsonAsync<T>();
    }

    // ========== DTOs ==========

    private sealed record CreateSpaceRequest(string Name, long? MaxUploadSize = null);

    private sealed record SpaceResponse(Guid Id, string Name, DateTime CreatedAt, long? MaxUploadSize, long EffectiveMaxUploadSize);

    private sealed record CreateInvitationRequest(string? ClientAppUrl);

    private sealed record ExchangeTokenRequest(string Pin, string DisplayName);

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
                    ["Cors:Origins"] = "https://localhost:5173",
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
