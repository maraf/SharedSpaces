using System.Collections.Concurrent;
using System.Data;
using System.IdentityModel.Tokens.Jwt;
using System.Runtime.ExceptionServices;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using SharedSpaces.Server.Domain;
using SharedSpaces.Server.Features.Hubs;
using SharedSpaces.Server.Features.Tokens;
using SharedSpaces.Server.Infrastructure.FileStorage;
using SharedSpaces.Server.Infrastructure.Persistence;

namespace SharedSpaces.Server.Features.Items;

public static class ItemEndpoints
{
    private static readonly ConcurrentDictionary<Guid, SemaphoreSlim> SpaceQuotaLocks = new();
    private const int DefaultMaxTextContentBytes = 1_048_576;
    private const int DefaultMaxTextToFileThresholdBytes = 65_536;

    public static IEndpointRouteBuilder MapItemEndpoints(this IEndpointRouteBuilder app)
    {
        var spaceGroup = app.MapGroup("/v1/spaces/{spaceId:guid}")
            .RequireAuthorization();

        spaceGroup.MapGet("/", GetSpaceInfo);

        var itemsGroup = spaceGroup.MapGroup("/items");
        itemsGroup.MapGet("/", GetItems);
        itemsGroup.MapGet("/{itemId:guid}/download", DownloadFile);
        itemsGroup.MapPut("/{itemId:guid}", UpsertItem)
            .DisableAntiforgery();
        itemsGroup.MapDelete("/{itemId:guid}", DeleteItem);
        itemsGroup.MapPost("/{itemId:guid}/transfer", TransferItem);

        return app;
    }

    private static async Task<IResult> GetSpaceInfo(
        Guid spaceId,
        HttpContext httpContext,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var authorizationResult = TryAuthorizeSpaceRequest(httpContext, spaceId, out _);
        if (authorizationResult is not null)
        {
            return authorizationResult;
        }

        var space = await db.Spaces
            .AsNoTracking()
            .SingleOrDefaultAsync(existingSpace => existingSpace.Id == spaceId, cancellationToken);

        return space is null
            ? Results.NotFound(new { Error = "Space not found" })
            : Results.Ok(new SpaceDetailsResponse(space.Id, space.Name, space.CreatedAt));
    }

    private static async Task<IResult> GetItems(
        Guid spaceId,
        HttpContext httpContext,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var authorizationResult = TryAuthorizeSpaceRequest(httpContext, spaceId, out _);
        if (authorizationResult is not null)
        {
            return authorizationResult;
        }

        var spaceExists = await db.Spaces
            .AsNoTracking()
            .AnyAsync(existingSpace => existingSpace.Id == spaceId, cancellationToken);

        if (!spaceExists)
        {
            return Results.NotFound(new { Error = "Space not found" });
        }

        var items = await db.SpaceItems
            .AsNoTracking()
            .Where(item => item.SpaceId == spaceId)
            .OrderByDescending(item => item.SharedAt)
            .Select(item => new SpaceItemResponse(
                item.Id,
                item.SpaceId,
                item.MemberId,
                item.ContentType,
                item.Content,
                item.FileSize,
                item.SharedAt))
            .ToListAsync(cancellationToken);

        return Results.Ok(items);
    }

    private static async Task<IResult> DownloadFile(
        Guid spaceId,
        Guid itemId,
        HttpContext httpContext,
        AppDbContext db,
        IFileStorage fileStorage,
        CancellationToken cancellationToken)
    {
        var authorizationResult = TryAuthorizeSpaceRequest(httpContext, spaceId, out _);
        if (authorizationResult is not null)
        {
            return authorizationResult;
        }

        var item = await db.SpaceItems
            .AsNoTracking()
            .SingleOrDefaultAsync(
                existing => existing.SpaceId == spaceId && existing.Id == itemId,
                cancellationToken);

        if (item is null || !string.Equals(item.ContentType, "file", StringComparison.OrdinalIgnoreCase))
        {
            return Results.NotFound(new { Error = "Item not found" });
        }

        Stream stream;
        try
        {
            stream = await fileStorage.ReadAsync(spaceId, itemId, cancellationToken);
        }
        catch (FileNotFoundException)
        {
            return Results.NotFound(new { Error = "Item not found" });
        }

        var fileName = !string.IsNullOrWhiteSpace(item.Content) ? item.Content : $"{itemId}.bin";
        return Results.File(stream, "application/octet-stream", fileName);
    }

    private static async Task<IResult> UpsertItem(
        Guid spaceId,
        Guid itemId,
        HttpContext httpContext,
        AppDbContext db,
        IFileStorage fileStorage,
        IOptions<StorageOptions> storageOptions,
        ISpaceHubNotifier hubNotifier,
        CancellationToken cancellationToken)
    {
        var authorizationResult = TryAuthorizeSpaceRequest(httpContext, spaceId, out var memberId);
        if (authorizationResult is not null)
        {
            return authorizationResult;
        }

        var displayName = httpContext.User.FindFirst(SpaceMemberClaimTypes.DisplayName)?.Value ?? string.Empty;

        var (request, requestError) = await ReadUpsertRequestAsync(httpContext.Request, cancellationToken);
        if (requestError is not null)
        {
            return requestError;
        }

        if (itemId == Guid.Empty)
        {
            return Results.BadRequest(new { Error = "Item ID must be a non-empty GUID" });
        }

        if (request!.Id == Guid.Empty)
        {
            return Results.BadRequest(new { Error = "Request item ID must be a non-empty GUID" });
        }

        if (request.Id != itemId)
        {
            return Results.BadRequest(new { Error = "Request item ID must match the route item ID" });
        }

        var normalizedContentType = request.ContentType.Trim().ToLowerInvariant();
        if (normalizedContentType is not ("text" or "file"))
        {
            return Results.BadRequest(new { Error = "ContentType must be either 'text' or 'file'" });
        }

        var space = await db.Spaces
            .AsNoTracking()
            .SingleOrDefaultAsync(existingSpace => existingSpace.Id == spaceId, cancellationToken);

        if (space is null)
        {
            return Results.NotFound(new { Error = "Space not found" });
        }

        IAsyncDisposable? quotaLock = null;
        IDbContextTransaction? transaction = null;
        
        try
        {
            if (normalizedContentType == "file")
            {
                quotaLock = await AcquireQuotaLockAsync(spaceId, cancellationToken);
                if (db.Database.IsRelational())
                {
                    transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);
                }
            }

            var existingItem = await db.SpaceItems
                .SingleOrDefaultAsync(item => item.SpaceId == spaceId && item.Id == itemId, cancellationToken);

            var item = existingItem ?? new SpaceItem(itemId)
            {
                SpaceId = spaceId
            };

            var wasFile = existingItem is not null && string.Equals(existingItem.ContentType, "file", StringComparison.OrdinalIgnoreCase);
            string content;
            long fileSize;

            if (normalizedContentType == "text")
            {
                if (request.File is not null)
                {
                    return Results.BadRequest(new { Error = "File payload is only allowed when ContentType is 'file'" });
                }

                if (request.Content is null)
                {
                    return Results.BadRequest(new { Error = "Content is required when ContentType is 'text'" });
                }

                var textByteCount = Encoding.UTF8.GetByteCount(request.Content);
                
                if (textByteCount > DefaultMaxTextContentBytes)
                {
                    return Results.BadRequest(new { Error = $"Text content must not exceed {DefaultMaxTextContentBytes} bytes" });
                }

                if (textByteCount > DefaultMaxTextToFileThresholdBytes)
                {
                    // Auto-convert to file
                    if (quotaLock is null)
                    {
                        quotaLock = await AcquireQuotaLockAsync(spaceId, cancellationToken);
                    }
                    
                    if (transaction is null && db.Database.IsRelational())
                    {
                        transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);
                    }
                    
                    var currentUsage = await db.SpaceItems
                        .Where(existing => existing.SpaceId == spaceId)
                        .SumAsync(existing => (long?)existing.FileSize, cancellationToken) ?? 0L;
                    var currentItemSize = existingItem?.FileSize ?? 0L;
                    var projectedUsage = currentUsage - currentItemSize + textByteCount;

                    var quota = space.MaxUploadSize ?? storageOptions.Value.MaxSpaceQuotaBytes;
                    if (projectedUsage > quota)
                    {
                        return Results.Json(new { Error = "Space storage quota exceeded" }, statusCode: StatusCodes.Status413PayloadTooLarge);
                    }
                    
                    await using var textStream = new MemoryStream(Encoding.UTF8.GetBytes(request.Content));
                    await fileStorage.SaveAsync(spaceId, itemId, textStream, cancellationToken);
                    
                    normalizedContentType = "file";
                    content = $"{itemId:N}.txt";
                    fileSize = textByteCount;
                }
                else
                {
                    content = request.Content;
                    fileSize = 0;
                }
            }
            else
            {
                if (request.File is null)
                {
                    return Results.BadRequest(new { Error = "File is required when ContentType is 'file'" });
                }

                var currentUsage = await db.SpaceItems
                    .Where(existing => existing.SpaceId == spaceId)
                    .SumAsync(existing => (long?)existing.FileSize, cancellationToken) ?? 0L;
                var currentItemSize = existingItem?.FileSize ?? 0L;
                var projectedUsage = currentUsage - currentItemSize + request.File.Length;

                var quota = space.MaxUploadSize ?? storageOptions.Value.MaxSpaceQuotaBytes;
                if (projectedUsage > quota)
                {
                    return Results.Json(new { Error = "Space storage quota exceeded" }, statusCode: StatusCodes.Status413PayloadTooLarge);
                }

                await using var fileStream = request.File.OpenReadStream();
                await fileStorage.SaveAsync(spaceId, itemId, fileStream, cancellationToken);
                content = request.File.FileName;
                fileSize = request.File.Length;
            }

            item.MemberId = memberId;
            item.ContentType = normalizedContentType;
            item.Content = content;
            item.FileSize = fileSize;
            item.SharedAt = DateTime.UtcNow;

            if (existingItem is null)
            {
                db.SpaceItems.Add(item);
            }

            try
            {
                await db.SaveChangesAsync(cancellationToken);

                if (transaction is not null)
                {
                    await transaction.CommitAsync(cancellationToken);
                }

                if (existingItem is null)
                {
                    var itemAddedEvent = new ItemAddedEvent(
                        item.Id,
                        item.SpaceId,
                        item.MemberId,
                        displayName,
                        item.ContentType,
                        item.Content,
                        item.FileSize,
                        item.SharedAt);

                    await hubNotifier.NotifyItemAddedAsync(itemAddedEvent, cancellationToken);
                }
            }
            catch (Exception exception)
            {
                if (transaction is not null)
                {
                    await transaction.RollbackAsync(cancellationToken);
                }

                if (normalizedContentType == "file" && existingItem is null)
                {
                    try
                    {
                        await fileStorage.DeleteAsync(spaceId, itemId, cancellationToken);
                    }
                    catch
                    {
                    }
                }

                ExceptionDispatchInfo.Capture(exception).Throw();
                throw;
            }

            if (wasFile && normalizedContentType != "file")
            {
                try
                {
                    await fileStorage.DeleteAsync(spaceId, itemId, cancellationToken);
                }
                catch
                {
                    // Best-effort file cleanup when switching from file to text
                }
            }

            var response = new SpaceItemResponse(
                item.Id,
                item.SpaceId,
                item.MemberId,
                item.ContentType,
                item.Content,
                item.FileSize,
                item.SharedAt);

            return existingItem is null
                ? Results.Created($"/v1/spaces/{spaceId}/items/{item.Id}", response)
                : Results.Ok(response);
        }
        finally
        {
            if (transaction is not null)
            {
                await transaction.DisposeAsync();
            }
            
            if (quotaLock is not null)
            {
                await quotaLock.DisposeAsync();
            }
        }
    }

    private static async Task<IResult> DeleteItem(
        Guid spaceId,
        Guid itemId,
        HttpContext httpContext,
        AppDbContext db,
        IFileStorage fileStorage,
        ISpaceHubNotifier hubNotifier,
        CancellationToken cancellationToken)
    {
        var authorizationResult = TryAuthorizeSpaceRequest(httpContext, spaceId, out _);
        if (authorizationResult is not null)
        {
            return authorizationResult;
        }

        var item = await db.SpaceItems
            .SingleOrDefaultAsync(existingItem => existingItem.SpaceId == spaceId && existingItem.Id == itemId, cancellationToken);

        if (item is null)
        {
            return Results.NotFound(new { Error = "Item not found" });
        }

        var isFile = string.Equals(item.ContentType, "file", StringComparison.OrdinalIgnoreCase);

        db.SpaceItems.Remove(item);
        await db.SaveChangesAsync(cancellationToken);

        var itemDeletedEvent = new ItemDeletedEvent(itemId, spaceId);
        await hubNotifier.NotifyItemDeletedAsync(itemDeletedEvent, cancellationToken);

        if (isFile)
        {
            try
            {
                await fileStorage.DeleteAsync(spaceId, itemId, cancellationToken);
            }
            catch
            {
                // Best-effort file cleanup
            }
        }

        return Results.NoContent();
    }

    private static async ValueTask<IAsyncDisposable> AcquireQuotaLockAsync(Guid spaceId, CancellationToken cancellationToken)
    {
        var quotaLock = SpaceQuotaLocks.GetOrAdd(spaceId, static _ => new SemaphoreSlim(1, 1));
        await quotaLock.WaitAsync(cancellationToken);
        return new Releaser(quotaLock);
    }

    private static async Task<(UpsertSpaceItemRequest? Request, IResult? Error)> ReadUpsertRequestAsync(
        HttpRequest httpRequest,
        CancellationToken cancellationToken)
    {
        if (!httpRequest.HasFormContentType)
        {
            return (null, Results.StatusCode(StatusCodes.Status415UnsupportedMediaType));
        }

        try
        {
            var form = await httpRequest.ReadFormAsync(cancellationToken);
            var idValue = form.TryGetValue("id", out var idValues)
                ? idValues.ToString()
                : string.Empty;
            var contentType = form.TryGetValue("contentType", out var contentTypeValues)
                ? contentTypeValues.ToString()
                : string.Empty;
            var content = form.TryGetValue("content", out var contentValues)
                ? contentValues.ToString()
                : null;
            Guid.TryParse(idValue, out var id);

            return (new UpsertSpaceItemRequest
            {
                Id = id,
                ContentType = contentType,
                Content = content,
                File = form.Files.GetFile("file")
            }, null);
        }
        catch (BadHttpRequestException)
        {
            return (null, Results.BadRequest(new { Error = "Invalid form payload" }));
        }
        catch (InvalidDataException)
        {
            return (null, Results.BadRequest(new { Error = "Invalid form payload" }));
        }
    }

    private static async Task<IResult> TransferItem(
        Guid spaceId,
        Guid itemId,
        TransferItemRequest request,
        HttpContext httpContext,
        AppDbContext db,
        IFileStorage fileStorage,
        IOptions<StorageOptions> storageOptions,
        ISpaceHubNotifier hubNotifier,
        IConfiguration configuration,
        CancellationToken cancellationToken)
    {
        // Authorize source space
        var authorizationResult = TryAuthorizeSpaceRequest(httpContext, spaceId, out _);
        if (authorizationResult is not null)
        {
            return authorizationResult;
        }

        // Validate action
        if (string.IsNullOrWhiteSpace(request.Action))
        {
            return Results.BadRequest(new { Error = "Action must be either 'copy' or 'move'" });
        }

        var action = request.Action.Trim().ToLowerInvariant();
        if (action is not ("copy" or "move"))
        {
            return Results.BadRequest(new { Error = "Action must be either 'copy' or 'move'" });
        }

        // Validate destination token
        var tokenHandler = new JwtSecurityTokenHandler
        {
            MapInboundClaims = false
        };
        var signingKey = JwtTokenSigningKeyFactory.Create(configuration);
        
        System.Security.Claims.ClaimsPrincipal? destinationPrincipal;
        try
        {
            destinationPrincipal = tokenHandler.ValidateToken(request.DestinationToken, new TokenValidationParameters
            {
                ValidateIssuerSigningKey = true,
                IssuerSigningKey = signingKey,
                ValidateIssuer = false,
                ValidateAudience = false,
                ValidateLifetime = false,
                RequireExpirationTime = false
            }, out _);
        }
        catch (Exception ex) when (ex is SecurityTokenException or ArgumentException)
        {
            return Results.BadRequest(new { Error = "Invalid destination token" });
        }

        // Extract destination member ID
        var destMemberClaim = destinationPrincipal.FindFirst(JwtRegisteredClaimNames.Sub)?.Value;
        if (!Guid.TryParse(destMemberClaim, out var destinationMemberId) || destinationMemberId == Guid.Empty)
        {
            return Results.BadRequest(new { Error = "Invalid destination token: missing or invalid member ID" });
        }

        // Verify destination member exists and not revoked
        var destinationMember = await db.SpaceMembers
            .AsNoTracking()
            .SingleOrDefaultAsync(m => m.Id == destinationMemberId, cancellationToken);

        if (destinationMember is null || destinationMember.IsRevoked)
        {
            return Results.BadRequest(new { Error = "Destination member is invalid or revoked" });
        }

        // Extract destination space ID from token
        var destSpaceClaim = destinationPrincipal.FindFirst(SpaceMemberClaimTypes.SpaceId)?.Value;
        if (!Guid.TryParse(destSpaceClaim, out var destinationSpaceId) || destinationSpaceId == Guid.Empty)
        {
            return Results.BadRequest(new { Error = "Invalid destination token: missing or invalid space_id" });
        }

        // Validate destination member belongs to the claimed space
        if (destinationMember.SpaceId != destinationSpaceId)
        {
            return Results.BadRequest(new { Error = "Destination token space does not match member's space" });
        }

        // Reject same-space transfer
        if (spaceId == destinationSpaceId)
        {
            return Results.BadRequest(new { Error = "Cannot transfer item to the same space" });
        }

        // Load source item
        var sourceItem = await db.SpaceItems
            .AsNoTracking()
            .SingleOrDefaultAsync(item => item.SpaceId == spaceId && item.Id == itemId, cancellationToken);

        if (sourceItem is null)
        {
            return Results.NotFound(new { Error = "Item not found" });
        }

        var isFile = string.Equals(sourceItem.ContentType, "file", StringComparison.OrdinalIgnoreCase);

        IAsyncDisposable? quotaLock = null;
        IDbContextTransaction? transaction = null;
        var newItemId = Guid.NewGuid();

        try
        {
            // Acquire destination space quota lock (always lock for file items)
            if (isFile)
            {
                quotaLock = await AcquireQuotaLockAsync(destinationSpaceId, cancellationToken);
                if (db.Database.IsRelational())
                {
                    transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);
                }
            }

            // Check destination quota
            if (isFile)
            {
                var destinationSpace = await db.Spaces
                    .AsNoTracking()
                    .SingleOrDefaultAsync(s => s.Id == destinationSpaceId, cancellationToken);

                if (destinationSpace is null)
                {
                    return Results.BadRequest(new { Error = "Destination space not found" });
                }

                var currentUsage = await db.SpaceItems
                    .Where(item => item.SpaceId == destinationSpaceId)
                    .SumAsync(item => (long?)item.FileSize, cancellationToken) ?? 0L;

                var quota = destinationSpace.MaxUploadSize ?? storageOptions.Value.MaxSpaceQuotaBytes;
                var projectedUsage = currentUsage + sourceItem.FileSize;

                if (projectedUsage > quota)
                {
                    return Results.Json(new { Error = "Destination space storage quota exceeded" }, statusCode: StatusCodes.Status413PayloadTooLarge);
                }
            }

            // Create new item in destination
            var destinationItem = new SpaceItem(newItemId)
            {
                SpaceId = destinationSpaceId,
                MemberId = destinationMemberId,
                ContentType = sourceItem.ContentType,
                Content = sourceItem.Content,
                FileSize = sourceItem.FileSize,
                SharedAt = DateTime.UtcNow
            };

            db.SpaceItems.Add(destinationItem);

            // Copy file if item is a file
            if (isFile)
            {
                await using var sourceStream = await fileStorage.ReadAsync(spaceId, itemId, cancellationToken);
                await fileStorage.SaveAsync(destinationSpaceId, newItemId, sourceStream, cancellationToken);
                
                // Update content to reference new item ID
                // Only rename auto-converted text files (Content == "{sourceItemId:N}.txt")
                var isAutoConvertedText = string.Equals(sourceItem.Content, $"{sourceItem.Id:N}.txt", StringComparison.OrdinalIgnoreCase);
                destinationItem.Content = isAutoConvertedText
                    ? $"{newItemId:N}.txt"
                    : sourceItem.Content;
            }

            // If move, delete source item
            if (action == "move")
            {
                var sourceItemTracked = await db.SpaceItems
                    .SingleOrDefaultAsync(item => item.SpaceId == spaceId && item.Id == itemId, cancellationToken);

                if (sourceItemTracked is not null)
                {
                    db.SpaceItems.Remove(sourceItemTracked);
                }
            }

            await db.SaveChangesAsync(cancellationToken);

            if (transaction is not null)
            {
                await transaction.CommitAsync(cancellationToken);
            }

            // Broadcast ItemAdded to destination space
            var destinationDisplayName = destinationPrincipal.FindFirst(SpaceMemberClaimTypes.DisplayName)?.Value ?? string.Empty;
            var itemAddedEvent = new ItemAddedEvent(
                destinationItem.Id,
                destinationItem.SpaceId,
                destinationItem.MemberId,
                destinationDisplayName,
                destinationItem.ContentType,
                destinationItem.Content,
                destinationItem.FileSize,
                destinationItem.SharedAt);

            await hubNotifier.NotifyItemAddedAsync(itemAddedEvent, cancellationToken);

            // Broadcast ItemDeleted to source space if move
            if (action == "move")
            {
                var itemDeletedEvent = new ItemDeletedEvent(itemId, spaceId);
                await hubNotifier.NotifyItemDeletedAsync(itemDeletedEvent, cancellationToken);

                // Clean up source file
                if (isFile)
                {
                    try
                    {
                        await fileStorage.DeleteAsync(spaceId, itemId, cancellationToken);
                    }
                    catch
                    {
                        // Best-effort cleanup
                    }
                }
            }

            var response = new SpaceItemResponse(
                destinationItem.Id,
                destinationItem.SpaceId,
                destinationItem.MemberId,
                destinationItem.ContentType,
                destinationItem.Content,
                destinationItem.FileSize,
                destinationItem.SharedAt);

            return Results.Created($"/v1/spaces/{destinationSpaceId}/items/{newItemId}", response);
        }
        catch (Exception exception)
        {
            if (transaction is not null)
            {
                await transaction.RollbackAsync(cancellationToken);
            }

            // Clean up destination file on failure
            if (isFile)
            {
                try
                {
                    await fileStorage.DeleteAsync(destinationSpaceId, newItemId, cancellationToken);
                }
                catch
                {
                    // Best-effort cleanup
                }
            }

            ExceptionDispatchInfo.Capture(exception).Throw();
            throw;
        }
        finally
        {
            if (transaction is not null)
            {
                await transaction.DisposeAsync();
            }

            if (quotaLock is not null)
            {
                await quotaLock.DisposeAsync();
            }
        }
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

    private sealed class Releaser(SemaphoreSlim semaphore) : IAsyncDisposable
    {
        public ValueTask DisposeAsync()
        {
            semaphore.Release();
            return ValueTask.CompletedTask;
        }
    }
}
