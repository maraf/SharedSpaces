using FluentAssertions;
using SharedSpaces.Server.Features.Items;

namespace SharedSpaces.Server.Tests;

public sealed class ExpiredItemsWakeSignalTests
{
    [Fact]
    public async Task WaitAsync_PreservesFutureWakeAfterEarlySignal()
    {
        var signal = new ExpiredItemsWakeSignal();
        var expiry = DateTime.UtcNow.AddMilliseconds(150);

        signal.RequestWakeAt(expiry);
        await signal.WaitAsync(TimeSpan.FromHours(1), CancellationToken.None);

        using var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        var stopwatch = System.Diagnostics.Stopwatch.StartNew();
        await signal.WaitAsync(TimeSpan.FromHours(1), cancellation.Token);

        stopwatch.Stop();
        stopwatch.Elapsed.Should().BeLessThan(TimeSpan.FromSeconds(1));
    }

    [Fact]
    public async Task RequestWakeAt_UsesEarlierRequest()
    {
        var signal = new ExpiredItemsWakeSignal();
        signal.RequestWakeAt(DateTime.UtcNow.AddSeconds(1));
        var earlierExpiry = DateTime.UtcNow.AddMilliseconds(150);
        signal.RequestWakeAt(earlierExpiry);

        await signal.WaitAsync(TimeSpan.FromHours(1), CancellationToken.None);

        using var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        var stopwatch = System.Diagnostics.Stopwatch.StartNew();
        await signal.WaitAsync(TimeSpan.FromHours(1), cancellation.Token);

        stopwatch.Stop();
        stopwatch.Elapsed.Should().BeLessThan(TimeSpan.FromSeconds(1));
    }

    [Fact]
    public async Task WaitAsync_ClearsWakeWhenExpiryIsDue()
    {
        var signal = new ExpiredItemsWakeSignal();
        signal.RequestWakeAt(DateTime.UtcNow.AddMilliseconds(-1));

        await signal.WaitAsync(TimeSpan.FromHours(1), CancellationToken.None);

        using var cancellation = new CancellationTokenSource(TimeSpan.FromMilliseconds(100));
        var secondWait = signal.WaitAsync(TimeSpan.FromHours(1), cancellation.Token);

        Func<Task> act = async () => await secondWait;
        await act.Should().ThrowAsync<OperationCanceledException>();
    }

    [Fact]
    public async Task WaitAsync_ObservesCancellation()
    {
        var signal = new ExpiredItemsWakeSignal();
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        Func<Task> act = () => signal.WaitAsync(TimeSpan.FromHours(1), cancellation.Token);
        await act.Should().ThrowAsync<OperationCanceledException>();
    }
}
