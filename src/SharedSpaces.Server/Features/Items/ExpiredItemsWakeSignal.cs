namespace SharedSpaces.Server.Features.Items;

/// <summary>
/// Lets item-creation code nudge <see cref="ExpiredItemsCleanupService"/> to wake up earlier
/// than its default sweep interval when a short-lived TTL item is added, without changing the
/// default cadence for items with no TTL or a TTL longer than the sweep interval.
/// </summary>
public interface IExpiredItemsWakeSignal
{
    /// <summary>
    /// Requests that the cleanup service wake up at or before the given UTC time.
    /// Has no effect if a sooner wake-up is already pending.
    /// </summary>
    void RequestWakeAt(DateTime utcExpiry);

    /// <summary>
    /// Waits until either the given default delay elapses or an earlier wake-up was requested.
    /// </summary>
    Task WaitAsync(TimeSpan defaultDelay, CancellationToken cancellationToken);
}

public sealed class ExpiredItemsWakeSignal : IExpiredItemsWakeSignal
{
    private readonly object gate = new();
    private readonly SemaphoreSlim signal = new(0, 1);
    private DateTime? nextRequestedWakeUtc;

    public void RequestWakeAt(DateTime utcExpiry)
    {
        lock (gate)
        {
            if (nextRequestedWakeUtc is { } existing && existing <= utcExpiry)
            {
                return;
            }

            nextRequestedWakeUtc = utcExpiry;
        }

        // Release is a no-op if already signaled (count is capped at 1).
        try
        {
            signal.Release();
        }
        catch (SemaphoreFullException)
        {
        }
    }

    public async Task WaitAsync(TimeSpan defaultDelay, CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var delay = defaultDelay;

        lock (gate)
        {
            if (nextRequestedWakeUtc is { } requestedWakeUtc)
            {
                var requestedDelay = requestedWakeUtc - now;
                if (requestedDelay < delay)
                {
                    delay = requestedDelay > TimeSpan.Zero ? requestedDelay : TimeSpan.Zero;
                }
            }
        }

        using var delayCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var delayTask = Task.Delay(delay, delayCts.Token);
        var signalTask = signal.WaitAsync(delayCts.Token);

        try
        {
            await Task.WhenAny(delayTask, signalTask);
        }
        finally
        {
            delayCts.Cancel();
        }

        lock (gate)
        {
            if (nextRequestedWakeUtc is { } requestedWakeUtc
                && requestedWakeUtc <= DateTime.UtcNow)
            {
                nextRequestedWakeUtc = null;
            }
        }

        cancellationToken.ThrowIfCancellationRequested();
    }
}
