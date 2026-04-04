using SharedSpaces.Server.Features.Items;

namespace SharedSpaces.Server.Features.Journal;

public sealed record JournalResponse(
    bool FullSyncRequired,
    DateTime Checkpoint,
    SpaceItemResponse[] AddedOrUpdated,
    DeletedItemResponse[] Deleted);

public sealed record DeletedItemResponse(Guid Id, string? Content);

public sealed record JournalCheckpointRequest(
    DateTimeOffset Checkpoint);
