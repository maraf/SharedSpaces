namespace SharedSpaces.Server.Features.Invitations;

public record CreateInvitationRequest(string? ClientAppUrl);

public record InvitationResponse(
    string InvitationString,
    string? QrCodeBase64);

public record InvitationListResponse(Guid Id, Guid SpaceId);
