using System.Security.Cryptography;
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

        group.MapPost("/", CreateInvitation)
            .AddEndpointFilter<AdminAuthenticationFilter>();

        return app;
    }

    private static async Task<IResult> CreateInvitation(
        Guid spaceId,
        CreateInvitationRequest request,
        AppDbContext db,
        IConfiguration configuration)
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

        var serverUrl = configuration["Server:Url"] ?? throw new InvalidOperationException("Server:Url not configured");
        var invitationString = $"{serverUrl}|{spaceId}|{pin}";

        string? qrCodeBase64 = null;
        var clientAppUrl = request.ClientAppUrl 
            ?? configuration["Server:DefaultClientAppUrl"];

        if (!string.IsNullOrWhiteSpace(clientAppUrl))
        {
            var fullJoinUrl = $"{clientAppUrl}/join?invitation={Uri.EscapeDataString(invitationString)}";
            qrCodeBase64 = GenerateQrCode(fullJoinUrl);
        }

        var response = new InvitationResponse(invitationString, qrCodeBase64);
        return Results.Ok(response);
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
