using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using SharedSpaces.Server.Domain;
using SharedSpaces.Server.Features.Items;
using SharedSpaces.Server.Infrastructure.Persistence;
using WebPush;

namespace SharedSpaces.Server.Features.Notifications;

public interface IWebPushDeliveryService
{
    Task NotifyItemCreatedAsync(SpaceItem item, string displayName, CancellationToken cancellationToken);
}

public sealed class WebPushDeliveryService(
    AppDbContext db,
    IOptions<WebPushOptions> options,
    ILogger<WebPushDeliveryService> logger) : IWebPushDeliveryService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task NotifyItemCreatedAsync(SpaceItem item, string displayName, CancellationToken cancellationToken)
    {
        if (!HasVapidConfiguration(options.Value))
        {
            return;
        }

        if (SpaceItemExpiry.IsExpired(item, DateTime.UtcNow))
        {
            return;
        }

        var subscriptions = await db.WebPushSubscriptions
            .AsNoTracking()
            .Where(subscription => subscription.SpaceId == item.SpaceId && !subscription.Member.IsRevoked)
            .Select(subscription => new
            {
                subscription.Id,
                subscription.Endpoint,
                subscription.P256Dh,
                subscription.Auth
            })
            .ToListAsync(cancellationToken);

        if (subscriptions.Count == 0)
        {
            return;
        }

        var payload = JsonSerializer.Serialize(new
        {
            type = "item-created",
            item = new
            {
                item.Id,
                item.SpaceId,
                item.MemberId,
                displayName,
                item.ContentType,
                item.Content,
                item.FileSize,
                item.SharedAt,
                item.TtlSeconds
            }
        }, JsonOptions);

        var vapid = new VapidDetails(
            options.Value.Subject,
            options.Value.PublicKey,
            options.Value.PrivateKey);
        var client = new WebPushClient();
        var staleSubscriptionIds = new List<Guid>();

        foreach (var subscription in subscriptions)
        {
            try
            {
                await client.SendNotificationAsync(
                    new PushSubscription(subscription.Endpoint, subscription.P256Dh, subscription.Auth),
                    payload,
                    vapid,
                    cancellationToken: cancellationToken);
            }
            catch (WebPushException exception) when (exception.StatusCode is System.Net.HttpStatusCode.Gone or System.Net.HttpStatusCode.NotFound)
            {
                staleSubscriptionIds.Add(subscription.Id);
            }
            catch (Exception exception)
            {
                logger.LogWarning(
                    exception,
                    "Failed to deliver WebPush notification for item {ItemId} to endpoint {Endpoint}",
                    item.Id,
                    subscription.Endpoint);
            }
        }

        if (staleSubscriptionIds.Count == 0)
        {
            return;
        }

        var staleSubscriptions = await db.WebPushSubscriptions
            .Where(subscription => staleSubscriptionIds.Contains(subscription.Id))
            .ToListAsync(cancellationToken);

        if (staleSubscriptions.Count == 0)
        {
            return;
        }

        db.WebPushSubscriptions.RemoveRange(staleSubscriptions);
        await db.SaveChangesAsync(cancellationToken);
    }

    internal static bool HasVapidConfiguration(WebPushOptions options)
    {
        return !string.IsNullOrWhiteSpace(options.Subject)
            && !string.IsNullOrWhiteSpace(options.PublicKey)
            && !string.IsNullOrWhiteSpace(options.PrivateKey);
    }
}
