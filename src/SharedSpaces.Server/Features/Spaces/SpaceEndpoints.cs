using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using SharedSpaces.Server.Domain;
using SharedSpaces.Server.Features.Admin;
using SharedSpaces.Server.Features.Hubs;
using SharedSpaces.Server.Infrastructure.FileStorage;
using SharedSpaces.Server.Infrastructure.Persistence;

namespace SharedSpaces.Server.Features.Spaces;

public static class SpaceEndpoints
{
    public static IEndpointRouteBuilder MapSpaceEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/v1/spaces");

        group.MapGet("/", GetSpaces)
            .AddEndpointFilter<AdminAuthenticationFilter>();

        group.MapPost("/", CreateSpace)
            .AddEndpointFilter<AdminAuthenticationFilter>();

        group.MapGet("/{spaceId:guid}/members", GetMembers)
            .AddEndpointFilter<AdminAuthenticationFilter>();

        group.MapPost("/{spaceId:guid}/members/{memberId:guid}/revoke", RevokeMember)
            .AddEndpointFilter<AdminAuthenticationFilter>();

        group.MapDelete("/{spaceId:guid}/members/{memberId:guid}", DeleteMember)
            .AddEndpointFilter<AdminAuthenticationFilter>();

        return app;
    }

    private static async Task<IResult> GetSpaces(AppDbContext db, IOptions<StorageOptions> storageOptions)
    {
        var serverDefault = storageOptions.Value.MaxSpaceQuotaBytes;

        var response = await db.Spaces
            .AsNoTracking()
            .OrderByDescending(space => space.CreatedAt)
            .Select(space => new SpaceResponse(space.Id, space.Name, space.CreatedAt, space.MaxUploadSize, space.MaxUploadSize ?? serverDefault))
            .ToListAsync();

        return Results.Ok(response);
    }

    private static async Task<IResult> CreateSpace(
        CreateSpaceRequest request,
        AppDbContext db,
        IOptions<StorageOptions> storageOptions)
    {
        var trimmedName = request.Name?.Trim() ?? string.Empty;

        if (string.IsNullOrWhiteSpace(trimmedName))
        {
            return Results.BadRequest(new { Error = "Name is required" });
        }

        if (trimmedName.Length > 200)
        {
            return Results.BadRequest(new { Error = "Name must not exceed 200 characters" });
        }

        var serverDefault = storageOptions.Value.MaxSpaceQuotaBytes;

        if (request.MaxUploadSize is not null)
        {
            if (request.MaxUploadSize <= 0)
            {
                return Results.BadRequest(new { Error = "MaxUploadSize must be greater than 0" });
            }

            if (request.MaxUploadSize > serverDefault)
            {
                return Results.BadRequest(new { Error = $"MaxUploadSize must not exceed server limit of {serverDefault} bytes" });
            }
        }

        var space = new Space
        {
            Name = trimmedName,
            MaxUploadSize = request.MaxUploadSize
        };

        db.Spaces.Add(space);
        await db.SaveChangesAsync();

        var response = new SpaceResponse(space.Id, space.Name, space.CreatedAt, space.MaxUploadSize, space.MaxUploadSize ?? serverDefault);
        return Results.Created($"/v1/spaces/{space.Id}", response);
    }

    private static async Task<IResult> GetMembers(
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

        var response = await db.SpaceMembers
            .AsNoTracking()
            .Where(member => member.SpaceId == spaceId)
            .OrderByDescending(member => member.JoinedAt)
            .Select(member => new MemberResponse(member.Id, member.DisplayName, member.JoinedAt, member.IsRevoked))
            .ToListAsync(cancellationToken);

        return Results.Ok(response);
    }

    private static async Task<IResult> RevokeMember(
        Guid spaceId,
        Guid memberId,
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

        var member = await db.SpaceMembers
            .SingleOrDefaultAsync(existingMember => existingMember.SpaceId == spaceId && existingMember.Id == memberId, cancellationToken);

        if (member is null)
        {
            return Results.NotFound(new { Error = "Member not found" });
        }

        if (!member.IsRevoked)
        {
            member.IsRevoked = true;
            await db.SaveChangesAsync(cancellationToken);
        }

        return Results.NoContent();
    }

    private static async Task<IResult> DeleteMember(
        Guid spaceId,
        Guid memberId,
        AppDbContext db,
        IFileStorage fileStorage,
        ISpaceHubNotifier hubNotifier,
        CancellationToken cancellationToken)
    {
        var spaceExists = await db.Spaces
            .AsNoTracking()
            .AnyAsync(space => space.Id == spaceId, cancellationToken);

        if (!spaceExists)
        {
            return Results.NotFound(new { Error = "Space not found" });
        }

        var member = await db.SpaceMembers
            .SingleOrDefaultAsync(existingMember => existingMember.SpaceId == spaceId && existingMember.Id == memberId, cancellationToken);

        if (member is null)
        {
            return Results.NotFound(new { Error = "Member not found" });
        }

        if (!member.IsRevoked)
        {
            return Results.Conflict(new { Error = "Member must be revoked before deletion" });
        }

        var items = await db.SpaceItems
            .Where(item => item.MemberId == memberId && item.SpaceId == spaceId)
            .ToListAsync(cancellationToken);

        foreach (var item in items)
        {
            var isFile = string.Equals(item.ContentType, "file", StringComparison.OrdinalIgnoreCase);
            if (isFile)
            {
                try
                {
                    await fileStorage.DeleteAsync(spaceId, item.Id, cancellationToken);
                }
                catch
                {
                    // Best-effort file cleanup
                }
            }
        }

        db.SpaceItems.RemoveRange(items);
        db.SpaceMembers.Remove(member);
        await db.SaveChangesAsync(cancellationToken);

        foreach (var item in items)
        {
            var itemDeletedEvent = new ItemDeletedEvent(item.Id, spaceId);
            await hubNotifier.NotifyItemDeletedAsync(itemDeletedEvent, cancellationToken);
        }

        return Results.NoContent();
    }
}
