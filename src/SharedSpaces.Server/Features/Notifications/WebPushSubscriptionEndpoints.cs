using System.IdentityModel.Tokens.Jwt;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using SharedSpaces.Server.Domain;
using SharedSpaces.Server.Features.Seeding;
using SharedSpaces.Server.Features.Tokens;
using SharedSpaces.Server.Infrastructure.Persistence;

namespace SharedSpaces.Server.Features.Notifications;

public static class WebPushSubscriptionEndpoints
{
    private const int MaxEndpointLength = 2000;
    private const int MaxKeyLength = 256;

    public static IEndpointRouteBuilder MapWebPushSubscriptionEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/v1/spaces/{spaceId:guid}/push-subscriptions")
            .RequireAuthorization();

        group.MapGet("/vapid-public-key", GetVapidPublicKey);
        group.MapGet("/status", GetStatus);
        group.MapPost("/", UpsertSubscription);
        group.MapPost("/unsubscribe", Unsubscribe);

        return app;
    }

    private static IResult GetVapidPublicKey(IOptions<WebPushOptions> options)
    {
        if (!WebPushDeliveryService.HasVapidConfiguration(options.Value))
        {
            return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
        }

        return Results.Ok(new WebPushPublicKeyResponse(options.Value.PublicKey));
    }

    private static async Task<IResult> GetStatus(
        Guid spaceId,
        HttpContext httpContext,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var authorizationResult = TryAuthorizeSpaceRequest(httpContext, spaceId, out var memberId);
        if (authorizationResult is not null)
        {
            return authorizationResult;
        }

        var enabled = await db.WebPushSubscriptions
            .AsNoTracking()
            .AnyAsync(subscription => subscription.SpaceId == spaceId && subscription.MemberId == memberId, cancellationToken);

        return Results.Ok(new WebPushSubscriptionStatusResponse(enabled));
    }

    private static async Task<IResult> UpsertSubscription(
        Guid spaceId,
        WebPushSubscriptionRequest request,
        HttpContext httpContext,
        AppDbContext db,
        ISystemClock systemClock,
        CancellationToken cancellationToken)
    {
        var authorizationResult = TryAuthorizeSpaceRequest(httpContext, spaceId, out var memberId);
        if (authorizationResult is not null)
        {
            return authorizationResult;
        }

        if (request is null || string.IsNullOrWhiteSpace(request.Endpoint))
        {
            return Results.BadRequest(new { Error = "Endpoint is required." });
        }

        if (request.Keys is null
            || string.IsNullOrWhiteSpace(request.Keys.P256Dh)
            || string.IsNullOrWhiteSpace(request.Keys.Auth))
        {
            return Results.BadRequest(new { Error = "Subscription keys are required." });
        }

        var endpoint = request.Endpoint.Trim();
        var p256Dh = request.Keys.P256Dh.Trim();
        var auth = request.Keys.Auth.Trim();
        if (endpoint.Length > MaxEndpointLength
            || p256Dh.Length > MaxKeyLength
            || auth.Length > MaxKeyLength)
        {
            return Results.BadRequest(new { Error = "Subscription endpoint or keys are too long." });
        }
        var now = systemClock.UtcNow;

        var existing = await db.WebPushSubscriptions
            .SingleOrDefaultAsync(
                subscription => subscription.SpaceId == spaceId
                    && subscription.MemberId == memberId
                    && subscription.Endpoint == endpoint,
                cancellationToken);

        if (existing is null)
        {
            db.WebPushSubscriptions.Add(new WebPushSubscription
            {
                Id = Guid.NewGuid(),
                SpaceId = spaceId,
                MemberId = memberId,
                Endpoint = endpoint,
                P256Dh = p256Dh,
                Auth = auth,
                CreatedAt = now,
                UpdatedAt = now
            });
        }
        else
        {
            existing.P256Dh = p256Dh;
            existing.Auth = auth;
            existing.UpdatedAt = now;
        }

        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> Unsubscribe(
        Guid spaceId,
        WebPushSubscriptionRequest request,
        HttpContext httpContext,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var authorizationResult = TryAuthorizeSpaceRequest(httpContext, spaceId, out var memberId);
        if (authorizationResult is not null)
        {
            return authorizationResult;
        }

        if (string.IsNullOrWhiteSpace(request.Endpoint))
        {
            return Results.BadRequest(new { Error = "Endpoint is required." });
        }

        var endpoint = request.Endpoint.Trim();
        var existing = await db.WebPushSubscriptions
            .SingleOrDefaultAsync(
                subscription => subscription.SpaceId == spaceId
                    && subscription.MemberId == memberId
                    && subscription.Endpoint == endpoint,
                cancellationToken);

        if (existing is null)
        {
            return Results.NoContent();
        }

        db.WebPushSubscriptions.Remove(existing);
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private static IResult? TryAuthorizeSpaceRequest(HttpContext httpContext, Guid routeSpaceId, out Guid memberId)
    {
        memberId = Guid.Empty;

        var memberClaim = httpContext.User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value;
        if (!Guid.TryParse(memberClaim, out memberId) || memberId == Guid.Empty)
        {
            return Results.Unauthorized();
        }

        var spaceClaim = httpContext.User.FindFirst(SpaceMemberClaimTypes.SpaceId)?.Value;
        if (!Guid.TryParse(spaceClaim, out var claimedSpaceId))
        {
            return Results.Unauthorized();
        }

        return claimedSpaceId == routeSpaceId
            ? null
            : Results.Forbid();
    }
}
