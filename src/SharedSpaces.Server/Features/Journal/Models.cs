using SharedSpaces.Server.Features.Items;

namespace SharedSpaces.Server.Features.Journal;

public sealed record JournalResponse(
    bool FullSyncRequired,
    SpaceItemResponse[] AddedOrUpdated,
    Guid[] Deleted);
