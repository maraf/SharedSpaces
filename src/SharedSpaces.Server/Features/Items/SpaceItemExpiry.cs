using SharedSpaces.Server.Domain;

namespace SharedSpaces.Server.Features.Items;

public static class SpaceItemExpiry
{
    public static bool IsExpired(SpaceItem item, DateTime utcNow)
    {
        return IsExpired(item.SharedAt, item.TtlSeconds, utcNow);
    }

    public static bool IsExpired(DateTime sharedAt, int? ttlSeconds, DateTime utcNow)
    {
        if (ttlSeconds is null)
        {
            return false;
        }

        if (ttlSeconds <= 0)
        {
            return true;
        }

        return sharedAt.AddSeconds(ttlSeconds.Value) <= utcNow;
    }
}
