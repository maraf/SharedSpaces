using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using SharedSpaces.Server.Domain;
using SharedSpaces.Server.Features.Invitations;
using SharedSpaces.Server.Infrastructure.Persistence;

namespace SharedSpaces.Server.Features.Tokens;

public static class TokenEndpoints
{
    public static IEndpointRouteBuilder MapTokenEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/v1/spaces/{spaceId:guid}/tokens");

        group.MapPost("/", ExchangePinForToken);

        return app;
    }

    private static async Task<IResult> ExchangePinForToken(
        Guid spaceId,
        CreateTokenRequest request,
        AppDbContext db,
        IConfiguration configuration,
        HttpRequest httpRequest)
    {
        if (string.IsNullOrWhiteSpace(request.Pin))
        {
            return Results.BadRequest(new { Error = "PIN is required" });
        }

        if (string.IsNullOrWhiteSpace(request.DisplayName))
        {
            return Results.BadRequest(new { Error = "Display name is required" });
        }

        var displayName = request.DisplayName.Trim();
        if (displayName.Length > 100)
        {
            return Results.BadRequest(new { Error = "Display name must not exceed 100 characters" });
        }

        var space = await db.Spaces
            .AsNoTracking()
            .SingleOrDefaultAsync(existingSpace => existingSpace.Id == spaceId);

        if (space == null)
        {
            return Results.NotFound(new { Error = "Space not found" });
        }

        var adminSecret = configuration["Admin:Secret"] ?? throw new InvalidOperationException("Admin:Secret not configured");
        var hashedPin = InvitationPinHasher.HashPin(request.Pin.Trim(), adminSecret);

        var invitation = await db.SpaceInvitations
            .FirstOrDefaultAsync(existingInvitation => existingInvitation.SpaceId == spaceId && existingInvitation.Pin == hashedPin);

        if (invitation == null)
        {
            return Results.Unauthorized();
        }

        var member = new SpaceMember
        {
            SpaceId = spaceId,
            DisplayName = displayName,
            JoinedAt = DateTime.UtcNow,
            IsRevoked = false
        };

        db.SpaceMembers.Add(member);
        db.SpaceInvitations.Remove(invitation);

        try
        {
            await db.SaveChangesAsync();
        }
        catch (DbUpdateConcurrencyException)
        {
            return Results.Unauthorized();
        }

        var serverUrl = $"{httpRequest.Scheme}://{httpRequest.Host}";
        var token = CreateToken(member, serverUrl, configuration);
        return Results.Ok(new TokenResponse(token));
    }

    private static string CreateToken(SpaceMember member, string serverUrl, IConfiguration configuration)
    {
        var signingCredentials = new SigningCredentials(
            JwtTokenSigningKeyFactory.Create(configuration),
            SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            claims:
            [
                new Claim(JwtRegisteredClaimNames.Sub, member.Id.ToString()),
                new Claim(SpaceMemberClaimTypes.DisplayName, member.DisplayName),
                new Claim(SpaceMemberClaimTypes.ServerUrl, serverUrl),
                new Claim(SpaceMemberClaimTypes.SpaceId, member.SpaceId.ToString())
            ],
            signingCredentials: signingCredentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
