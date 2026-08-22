namespace SharedSpaces.Server.Features.Notifications;

public sealed record WebPushPublicKeyResponse(string PublicKey);

public sealed record WebPushSubscriptionRequest(
    string? Endpoint,
    WebPushSubscriptionKeysRequest? Keys);

public sealed record WebPushSubscriptionKeysRequest(
    string? P256Dh,
    string? Auth);

public sealed record WebPushSubscriptionStatusResponse(
    bool Enabled);
