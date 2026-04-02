using SharedSpaces.Server.Features.Items;

namespace SharedSpaces.Server.Features.Journal;

public sealed record JournalResponse(
    bool FullSyncRequired,
    DateTime Checkpoint,
    SpaceItemResponse[] AddedOrUpdated,
    Guid[] Deleted);

public sealed record JournalCheckpointRequest(
    DateTime Checkpoint);
