using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using SharedSpaces.Server.Domain;
using SharedSpaces.Server.Features.Hubs;
using SharedSpaces.Server.Features.Journal;
using SharedSpaces.Server.Infrastructure.Persistence;

namespace SharedSpaces.Server.Features.Items;

public sealed class ExpiredItemsCleanupService(
    IServiceScopeFactory scopeFactory,
    IExpiredItemsWakeSignal wakeSignal,
    ILogger<ExpiredItemsCleanupService> logger) : BackgroundService
{
    private static readonly TimeSpan SweepInterval = TimeSpan.FromHours(1);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await CleanupAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                logger.LogError(exception, "Failed while cleaning up expired space items.");
            }

            try
            {
                // Waits up to the default sweep interval, but wakes earlier if an item with a
                // sooner TTL expiry was created in the meantime (see IExpiredItemsWakeSignal).
                await wakeSignal.WaitAsync(SweepInterval, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
        }
    }

    private async Task CleanupAsync(CancellationToken cancellationToken)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var hubNotifier = scope.ServiceProvider.GetRequiredService<ISpaceHubNotifier>();
        var journalOptions = scope.ServiceProvider.GetRequiredService<IOptions<JournalOptions>>();
        var now = DateTime.UtcNow;

        var expiringItems = await db.SpaceItems
            .Where(item => item.TtlSeconds != null)
            // Keep the database sweep bounded, while retaining the same boundary semantics as
            // SpaceItemExpiry.IsExpired. A future SharedAt must not be made to expire early.
            .Where(item => item.TtlSeconds <= 0 || item.SharedAt <= now.AddSeconds(-item.TtlSeconds!.Value))
            .Select(item => new
            {
                item.Id,
                item.SpaceId,
                item.ContentType,
                item.Content,
                item.SharedAt,
                item.TtlSeconds
            })
            .ToListAsync(cancellationToken);

        var expiredIds = expiringItems
            .Where(item => SpaceItemExpiry.IsExpired(item.SharedAt, item.TtlSeconds, now))
            .Select(item => item.Id)
            .ToHashSet();

        if (expiredIds.Count == 0)
        {
            return;
        }

        var expiredItems = await db.SpaceItems
            .Where(item => expiredIds.Contains(item.Id))
            .ToListAsync(cancellationToken);

        if (expiredItems.Count == 0)
        {
            return;
        }

        var hasJournalSubscribersBySpace = await db.SpaceMembers
            .Where(member => member.LastSyncAt != null)
            .GroupBy(member => member.SpaceId)
            .Select(group => new { group.Key })
            .ToDictionaryAsync(group => group.Key, _ => true, cancellationToken);

        foreach (var item in expiredItems)
        {
            if (hasJournalSubscribersBySpace.TryGetValue(item.SpaceId, out var hasJournalSubscribers) && hasJournalSubscribers)
            {
                var content = string.Equals(item.ContentType, "file", StringComparison.OrdinalIgnoreCase)
                    ? item.Content
                    : null;
                await UpsertDeletedItemAsync(db, item.Id, item.SpaceId, content, cancellationToken);
            }
        }

        db.SpaceItems.RemoveRange(expiredItems);
        await db.SaveChangesAsync(cancellationToken);

        foreach (var item in expiredItems)
        {
            await hubNotifier.NotifyItemDeletedAsync(new ItemDeletedEvent(item.Id, item.SpaceId), cancellationToken);
        }

        foreach (var spaceId in expiredItems.Select(item => item.SpaceId).Distinct())
        {
            if (hasJournalSubscribersBySpace.TryGetValue(spaceId, out var hasJournalSubscribers) && hasJournalSubscribers)
            {
                await PruneDeletedItemsAsync(db, spaceId, journalOptions.Value, cancellationToken);
            }
        }
    }

    private static async Task UpsertDeletedItemAsync(
        AppDbContext db,
        Guid itemId,
        Guid spaceId,
        string? content,
        CancellationToken cancellationToken)
    {
        var existing = await db.DeletedItems
            .SingleOrDefaultAsync(d => d.ItemId == itemId, cancellationToken);

        if (existing is not null)
        {
            existing.SpaceId = spaceId;
            existing.DeletedAt = DateTime.UtcNow;
            existing.Content = content;
        }
        else
        {
            db.DeletedItems.Add(new DeletedItem
            {
                ItemId = itemId,
                SpaceId = spaceId,
                DeletedAt = DateTime.UtcNow,
                Content = content
            });
        }
    }

    private static async Task PruneDeletedItemsAsync(
        AppDbContext db,
        Guid spaceId,
        JournalOptions journalOptions,
        CancellationToken cancellationToken)
    {
        if (journalOptions.MaxEntriesPerSpace is not { } maxEntries)
        {
            return;
        }

        var count = await db.DeletedItems
            .CountAsync(d => d.SpaceId == spaceId, cancellationToken);

        if (count <= maxEntries)
        {
            return;
        }

        var excess = count - maxEntries;

        var oldestEntries = await db.DeletedItems
            .Where(d => d.SpaceId == spaceId)
            .OrderBy(d => d.DeletedAt)
            .Take(excess)
            .ToListAsync(cancellationToken);

        if (oldestEntries.Count == 0)
        {
            return;
        }

        var watermark = oldestEntries.Max(d => d.DeletedAt);

        db.DeletedItems.RemoveRange(oldestEntries);

        var space = await db.Spaces.SingleOrDefaultAsync(s => s.Id == spaceId, cancellationToken);
        if (space is not null)
        {
            space.JournalPrunedBefore = watermark;
        }

        await db.SaveChangesAsync(cancellationToken);
    }
}
