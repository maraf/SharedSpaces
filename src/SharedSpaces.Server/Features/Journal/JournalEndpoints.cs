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

        return app;
    }

    private static async Task<IResult> GetJournal(
        Guid spaceId,
        HttpContext httpContext,
        AppDbContext db,
        CancellationToken cancellationToken,
        DateTime? since = null)
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

        var sinceUtc = since?.ToUniversalTime() ?? DateTime.MinValue;
        var fullSyncRequired = space.JournalPrunedBefore.HasValue && sinceUtc < space.JournalPrunedBefore.Value;

        var addedOrUpdated = await db.SpaceItems
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
                item.SharedAt))
            .ToArrayAsync(cancellationToken);

        Guid[] deleted;
        if (fullSyncRequired)
        {
            deleted = [];
        }
        else
        {
            deleted = await db.DeletedItems
                .AsNoTracking()
                .Where(d => d.SpaceId == spaceId && d.DeletedAt >= sinceUtc)
                .OrderBy(d => d.DeletedAt)
                .Select(d => d.ItemId)
                .ToArrayAsync(cancellationToken);
        }

        // Update requesting member's LastSyncAt
        var member = await db.SpaceMembers
            .SingleOrDefaultAsync(m => m.Id == memberId && m.SpaceId == spaceId, cancellationToken);

        if (member is not null)
        {
            member.LastSyncAt = DateTime.UtcNow;
            await db.SaveChangesAsync(cancellationToken);
        }

        return Results.Ok(new JournalResponse(fullSyncRequired, addedOrUpdated, deleted));
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
