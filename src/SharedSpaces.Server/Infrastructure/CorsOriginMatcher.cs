namespace SharedSpaces.Server.Infrastructure;

public static class CorsOriginMatcher
{
    /// <summary>
    /// Returns true when <paramref name="origin"/> matches <paramref name="pattern"/>.
    /// The pattern may contain one or more <c>*</c> characters, each matching any
    /// (possibly empty) substring. Matching is case-insensitive.
    /// </summary>
    public static bool IsWildcardMatch(string origin, string pattern)
    {
        if (string.IsNullOrEmpty(origin) || string.IsNullOrEmpty(pattern))
            return false;

        if (!pattern.Contains('*'))
            return string.Equals(origin, pattern, StringComparison.OrdinalIgnoreCase);

        var segments = pattern.Split('*');

        // First segment must match at the start
        if (!origin.StartsWith(segments[0], StringComparison.OrdinalIgnoreCase))
            return false;

        var pos = segments[0].Length;

        // Last segment must match at the end
        if (segments[^1].Length > 0 && !origin.EndsWith(segments[^1], StringComparison.OrdinalIgnoreCase))
            return false;

        var endBound = origin.Length - segments[^1].Length;

        // Middle segments must appear in order between prefix and suffix
        for (var i = 1; i < segments.Length - 1; i++)
        {
            if (segments[i].Length == 0) continue;

            var idx = origin.IndexOf(segments[i], pos, StringComparison.OrdinalIgnoreCase);
            if (idx < 0 || idx + segments[i].Length > endBound)
                return false;

            pos = idx + segments[i].Length;
        }

        return pos <= endBound;
    }
}
