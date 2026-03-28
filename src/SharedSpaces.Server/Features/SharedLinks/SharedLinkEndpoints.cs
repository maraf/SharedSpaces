using System.IdentityModel.Tokens.Jwt;
using Microsoft.EntityFrameworkCore;
using SharedSpaces.Server.Domain;
using SharedSpaces.Server.Features.Tokens;
using SharedSpaces.Server.Infrastructure.FileStorage;
using SharedSpaces.Server.Infrastructure.Persistence;

namespace SharedSpaces.Server.Features.SharedLinks;

public static class SharedLinkEndpoints
{
    public static IEndpointRouteBuilder MapSharedLinkEndpoints(this IEndpointRouteBuilder app)
    {
        // Authenticated endpoints (space member required)
        var memberGroup = app.MapGroup("/v1/spaces/{spaceId:guid}/items/{itemId:guid}/share")
            .RequireAuthorization();

        memberGroup.MapPost("/", CreateSharedLink);
        memberGroup.MapGet("/", ListSharedLinks);
        memberGroup.MapDelete("/{linkId:guid}", DeleteSharedLink);

        // Public endpoints (no auth)
        var publicGroup = app.MapGroup("/v1/shared");

        publicGroup.MapGet("/{token:guid}", GetSharedItem);
        publicGroup.MapGet("/{token:guid}/download", DownloadSharedFile);

        return app;
    }

    private static async Task<IResult> CreateSharedLink(
        Guid spaceId,
        Guid itemId,
        HttpContext httpContext,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var authorizationResult = TryAuthorizeSpaceRequest(httpContext, spaceId, out var memberId);
        if (authorizationResult is not null)
        {
            return authorizationResult;
        }

        var item = await db.SpaceItems
            .AsNoTracking()
            .SingleOrDefaultAsync(
                existing => existing.SpaceId == spaceId && existing.Id == itemId,
                cancellationToken);

        if (item is null)
        {
            return Results.NotFound(new { Error = "Item not found" });
        }

        var link = new SharedLink
        {
            SpaceId = spaceId,
            ItemId = itemId,
            CreatedBy = memberId
        };

        db.SharedLinks.Add(link);
        await db.SaveChangesAsync(cancellationToken);

        var response = new SharedLinkResponse(
            link.Id, link.Token, link.SpaceId, link.ItemId, link.CreatedBy, link.CreatedAt);

        return Results.Created($"/v1/spaces/{spaceId}/items/{itemId}/share/{link.Id}", response);
    }

    private static async Task<IResult> ListSharedLinks(
        Guid spaceId,
        Guid itemId,
        HttpContext httpContext,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var authorizationResult = TryAuthorizeSpaceRequest(httpContext, spaceId, out _);
        if (authorizationResult is not null)
        {
            return authorizationResult;
        }

        var itemExists = await db.SpaceItems
            .AsNoTracking()
            .AnyAsync(
                existing => existing.SpaceId == spaceId && existing.Id == itemId,
                cancellationToken);

        if (!itemExists)
        {
            return Results.NotFound(new { Error = "Item not found" });
        }

        var links = await db.SharedLinks
            .AsNoTracking()
            .Where(link => link.SpaceId == spaceId && link.ItemId == itemId)
            .OrderByDescending(link => link.CreatedAt)
            .Select(link => new SharedLinkResponse(
                link.Id, link.Token, link.SpaceId, link.ItemId, link.CreatedBy, link.CreatedAt))
            .ToListAsync(cancellationToken);

        return Results.Ok(links);
    }

    private static async Task<IResult> DeleteSharedLink(
        Guid spaceId,
        Guid itemId,
        Guid linkId,
        HttpContext httpContext,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var authorizationResult = TryAuthorizeSpaceRequest(httpContext, spaceId, out _);
        if (authorizationResult is not null)
        {
            return authorizationResult;
        }

        var link = await db.SharedLinks
            .SingleOrDefaultAsync(
                existing => existing.SpaceId == spaceId && existing.ItemId == itemId && existing.Id == linkId,
                cancellationToken);

        if (link is null)
        {
            return Results.NotFound(new { Error = "Shared link not found" });
        }

        db.SharedLinks.Remove(link);
        await db.SaveChangesAsync(cancellationToken);

        return Results.NoContent();
    }

    private static async Task<IResult> GetSharedItem(
        Guid token,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var link = await db.SharedLinks
            .AsNoTracking()
            .Include(l => l.Item)
            .SingleOrDefaultAsync(l => l.Token == token, cancellationToken);

        if (link is null)
        {
            return Results.NotFound(new { Error = "Shared link not found" });
        }

        var item = link.Item;
        var displayContent = string.Equals(item.ContentType, "file", StringComparison.OrdinalIgnoreCase)
            ? item.Content  // filename for files
            : item.Content; // text content for text items

        var response = new SharedItemResponse(
            item.ContentType,
            displayContent,
            item.FileSize,
            item.SharedAt);

        return Results.Ok(response);
    }

    private static async Task<IResult> DownloadSharedFile(
        Guid token,
        AppDbContext db,
        IFileStorage fileStorage,
        CancellationToken cancellationToken)
    {
        var link = await db.SharedLinks
            .AsNoTracking()
            .Include(l => l.Item)
            .SingleOrDefaultAsync(l => l.Token == token, cancellationToken);

        if (link is null)
        {
            return Results.NotFound(new { Error = "Shared link not found" });
        }

        var item = link.Item;
        if (!string.Equals(item.ContentType, "file", StringComparison.OrdinalIgnoreCase))
        {
            return Results.NotFound(new { Error = "Item is not a file" });
        }

        return await DownloadFileCore(item.SpaceId, item.Id, item.Content, fileStorage, cancellationToken);
    }

    internal static async Task<IResult> DownloadFileCore(
        Guid spaceId,
        Guid itemId,
        string content,
        IFileStorage fileStorage,
        CancellationToken cancellationToken)
    {
        Stream stream;
        try
        {
            stream = await fileStorage.ReadAsync(spaceId, itemId, cancellationToken);
        }
        catch (FileNotFoundException)
        {
            return Results.NotFound(new { Error = "Item not found" });
        }

        var fileName = !string.IsNullOrWhiteSpace(content) ? content : $"{itemId}.bin";
        return Results.File(stream, "application/octet-stream", fileName);
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
