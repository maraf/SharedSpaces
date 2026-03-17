using Microsoft.AspNetCore.SignalR;

namespace SharedSpaces.Server.Features.Hubs;

public interface ISpaceHubNotifier
{
    Task NotifyItemAddedAsync(ItemAddedEvent itemAddedEvent, CancellationToken cancellationToken);
    Task NotifyItemDeletedAsync(ItemDeletedEvent itemDeletedEvent, CancellationToken cancellationToken);
}

public sealed class SpaceHubNotifier(
    IHubContext<SpaceHub> hubContext,
    ILogger<SpaceHubNotifier> logger) : ISpaceHubNotifier
{
    public Task NotifyItemAddedAsync(ItemAddedEvent itemAddedEvent, CancellationToken cancellationToken)
    {
        return NotifyAsync(itemAddedEvent.SpaceId, "ItemAdded", itemAddedEvent, cancellationToken);
    }

    public Task NotifyItemDeletedAsync(ItemDeletedEvent itemDeletedEvent, CancellationToken cancellationToken)
    {
        return NotifyAsync(itemDeletedEvent.SpaceId, "ItemDeleted", itemDeletedEvent, cancellationToken);
    }

    private async Task NotifyAsync<TPayload>(Guid spaceId, string methodName, TPayload payload, CancellationToken cancellationToken)
    {
        try
        {
            await hubContext.Clients
                .Group(SpaceHub.GetSpaceGroupName(spaceId))
                .SendAsync(methodName, payload, cancellationToken);
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Failed to broadcast {MethodName} to space {SpaceId}", methodName, spaceId);
        }
    }
}
