using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using QRCoder;
using SharedSpaces.Server.Domain;
using SharedSpaces.Server.Features.Admin;
using SharedSpaces.Server.Infrastructure.Persistence;

namespace SharedSpaces.Server.Features.Invitations;

public static class InvitationEndpoints
{
    public static IEndpointRouteBuilder MapInvitationEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/v1/spaces/{spaceId:guid}/invitations");

        group.MapGet("/", GetInvitations)
            .AddEndpointFilter<AdminAuthenticationFilter>();

        group.MapPost("/", CreateInvitation)
            .AddEndpointFilter<AdminAuthenticationFilter>();

        group.MapDelete("/{invitationId:guid}", DeleteInvitation)
            .AddEndpointFilter<AdminAuthenticationFilter>();

        return app;
    }

    private static async Task<IResult> GetInvitations(
        Guid spaceId,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var spaceExists = await db.Spaces
            .AsNoTracking()
            .AnyAsync(space => space.Id == spaceId, cancellationToken);

        if (!spaceExists)
        {
            return Results.NotFound(new { Error = "Space not found" });
        }

        var response = await db.SpaceInvitations
            .AsNoTracking()
            .Where(invitation => invitation.SpaceId == spaceId)
            .Select(invitation => new InvitationListResponse(invitation.Id, invitation.SpaceId))
            .ToListAsync(cancellationToken);

        return Results.Ok(response);
    }

    private static async Task<IResult> CreateInvitation(
        Guid spaceId,
        CreateInvitationRequest request,
        AppDbContext db,
        IConfiguration configuration,
        HttpRequest httpRequest)
    {
        var space = await db.Spaces.FindAsync(spaceId);
        if (space == null)
        {
            return Results.NotFound(new { Error = "Space not found" });
        }

        var pin = GeneratePin();
        var adminSecret = configuration["Admin:Secret"] ?? throw new InvalidOperationException("Admin:Secret not configured");
        var hashedPin = InvitationPinHasher.HashPin(pin, adminSecret);

        var invitation = new SpaceInvitation
        {
            SpaceId = spaceId,
            Pin = hashedPin
        };

        db.SpaceInvitations.Add(invitation);
        await db.SaveChangesAsync();

        var serverUrl = $"{httpRequest.Scheme}://{httpRequest.Host}";
        var invitationString = $"{serverUrl}|{spaceId}|{pin}";

        string? qrCodeBase64 = null;
        var clientAppUrl = request.ClientAppUrl;

        if (!string.IsNullOrWhiteSpace(clientAppUrl))
        {
            var fullJoinUrl = $"{clientAppUrl}/?join={Uri.EscapeDataString(invitationString)}";
            qrCodeBase64 = GenerateQrCode(fullJoinUrl);
        }

        var response = new InvitationResponse(invitationString, qrCodeBase64);
        return Results.Ok(response);
    }

    private static async Task<IResult> DeleteInvitation(
        Guid spaceId,
        Guid invitationId,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var spaceExists = await db.Spaces
            .AsNoTracking()
            .AnyAsync(space => space.Id == spaceId, cancellationToken);

        if (!spaceExists)
        {
            return Results.NotFound(new { Error = "Space not found" });
        }

        var invitation = await db.SpaceInvitations
            .SingleOrDefaultAsync(existingInvitation => existingInvitation.SpaceId == spaceId && existingInvitation.Id == invitationId, cancellationToken);

        if (invitation is null)
        {
            return Results.NotFound(new { Error = "Invitation not found" });
        }

        db.SpaceInvitations.Remove(invitation);
        await db.SaveChangesAsync(cancellationToken);

        return Results.NoContent();
    }

    private static string GeneratePin()
    {
        return RandomNumberGenerator.GetInt32(100000, 1000000).ToString("D6");
    }

    private static string GenerateQrCode(string data)
    {
        using var qrGenerator = new QRCodeGenerator();
        using var qrCodeData = qrGenerator.CreateQrCode(data, QRCodeGenerator.ECCLevel.Q);
        using var qrCode = new PngByteQRCode(qrCodeData);
        var qrCodeImage = qrCode.GetGraphic(20);
        return Convert.ToBase64String(qrCodeImage);
    }
}
