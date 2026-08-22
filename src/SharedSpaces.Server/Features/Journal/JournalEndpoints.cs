using System.IdentityModel.Tokens.Jwt;
using Microsoft.EntityFrameworkCore;
using SharedSpaces.Server.Features.Items;
using SharedSpaces.Server.Features.Tokens;
using SharedSpaces.Server.Infrastructure.Persistence;

namespace SharedSpaces.Server.Features.Journal;

public static class JournalEndpoints
{
    public static IEndpointRouteBuilder MapJournalEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/v1/spaces/{spaceId:guid}/journal")
            .RequireAuthorization();

        group.MapGet("/", GetJournal);
        group.MapPost("/checkpoint", UpdateCheckpoint);
        group.MapDelete("/checkpoint", ResetCheckpoint);

        return app;
    }

    private static async Task<IResult> GetJournal(
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

        var space = await db.Spaces
            .AsNoTracking()
            .SingleOrDefaultAsync(s => s.Id == spaceId, cancellationToken);

        if (space is null)
        {
            return Results.NotFound(new { Error = "Space not found" });
        }

        var member = await db.SpaceMembers
            .SingleOrDefaultAsync(m => m.Id == memberId && m.SpaceId == spaceId, cancellationToken);

        if (member is null)
        {
            return Results.Unauthorized();
        }

        if (member.LastSyncAt is null)
        {
            // Enroll the member into journaling without acknowledging any progress yet.
            member.LastSyncAt = DateTime.SpecifyKind(DateTime.MinValue, DateTimeKind.Utc);
            await db.SaveChangesAsync(cancellationToken);
        }

        var sinceUtc = DateTime.SpecifyKind(member.LastSyncAt.Value, DateTimeKind.Utc);
        var checkpointUtc = DateTime.UtcNow;
        var fullSyncRequired = space.JournalPrunedBefore.HasValue && sinceUtc <= space.JournalPrunedBefore.Value;

        SpaceItemResponse[] addedOrUpdated;
        DeletedItemResponse[] deleted;
        if (fullSyncRequired)
        {
            addedOrUpdated = [];
            deleted = [];
        }
        else
        {
            var now = DateTime.UtcNow;
            addedOrUpdated = await db.SpaceItems
                .AsNoTracking()
                .Where(item => item.SpaceId == spaceId && item.SharedAt >= sinceUtc)
                .OrderBy(item => item.SharedAt)
                .Select(item => new SpaceItemResponse(
                    item.Id,
                    item.SpaceId,
                    item.MemberId,
                    item.ContentType,
                    item.Content,
                    item.FileSize,
                    item.SharedAt,
                    item.TtlSeconds))
                .ToArrayAsync(cancellationToken);
            addedOrUpdated = addedOrUpdated
                .Where(item => !SpaceItemExpiry.IsExpired(item.SharedAt, item.TtlSeconds, now))
                .ToArray();

            deleted = await db.DeletedItems
                .AsNoTracking()
                .Where(d => d.SpaceId == spaceId && d.DeletedAt >= sinceUtc)
                .OrderBy(d => d.DeletedAt)
                .Select(d => new DeletedItemResponse(d.ItemId, d.Content))
                .ToArrayAsync(cancellationToken);
        }

        return Results.Ok(new JournalResponse(fullSyncRequired, checkpointUtc, addedOrUpdated, deleted));
    }

    private static async Task<IResult> UpdateCheckpoint(
        Guid spaceId,
        JournalCheckpointRequest request,
        HttpContext httpContext,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var authorizationResult = TryAuthorizeSpaceRequest(httpContext, spaceId, out var memberId);
        if (authorizationResult is not null)
        {
            return authorizationResult;
        }

        if (request.Checkpoint == default)
        {
            return Results.BadRequest(new { Error = "The 'checkpoint' value is required." });
        }

        var checkpointUtc = request.Checkpoint.UtcDateTime;

        var member = await db.SpaceMembers
            .SingleOrDefaultAsync(m => m.Id == memberId && m.SpaceId == spaceId, cancellationToken);

        if (member is null)
        {
            return Results.Unauthorized();
        }

        if (member.LastSyncAt is null || checkpointUtc > member.LastSyncAt.Value)
        {
            member.LastSyncAt = checkpointUtc;
            await db.SaveChangesAsync(cancellationToken);
        }

        return Results.NoContent();
    }

    private static async Task<IResult> ResetCheckpoint(
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

        var member = await db.SpaceMembers
            .SingleOrDefaultAsync(m => m.Id == memberId && m.SpaceId == spaceId, cancellationToken);

        if (member is null)
        {
            return Results.Unauthorized();
        }

        if (member.LastSyncAt is not null)
        {
            member.LastSyncAt = null;
            await db.SaveChangesAsync(cancellationToken);
        }

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
