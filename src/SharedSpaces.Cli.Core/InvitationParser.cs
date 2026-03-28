using System.Text.RegularExpressions;
using System.Web;
using SharedSpaces.Cli.Core.Models;

namespace SharedSpaces.Cli.Core;

public static partial class InvitationParser
{
    [GeneratedRegex(@"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", RegexOptions.IgnoreCase)]
    private static partial Regex GuidPattern();

    [GeneratedRegex(@"^\d{6}$")]
    private static partial Regex PinPattern();

    /// <summary>
    /// Parses a raw invitation string in the format "serverUrl|pin" (new) or "serverUrl|spaceId[|pin]" (legacy).
    /// Discrimination: if part[1] is a GUID → legacy format; if part[1] is a 6-digit PIN → new format.
    /// </summary>
    public static InvitationData? ParseInvitationString(string invitation)
    {
        var parts = invitation.Split('|');
        if (parts.Length < 2 || parts.Length > 3)
            return null;

        var serverUrl = parts[0].Trim();

        if (!Uri.TryCreate(serverUrl, UriKind.Absolute, out var uri)
            || (uri.Scheme != "http" && uri.Scheme != "https"))
            return null;

        var secondPart = parts[1].Trim();

        // New format: serverUrl|pin
        if (parts.Length == 2 && PinPattern().IsMatch(secondPart))
        {
            return new InvitationData
            {
                ServerUrl = serverUrl,
                SpaceId = null,
                Pin = secondPart
            };
        }

        // Legacy format: serverUrl|spaceId[|pin]
        if (!GuidPattern().IsMatch(secondPart))
            return null;

        var spaceId = secondPart;
        var pin = parts.Length == 3 ? parts[2].Trim() : null;

        if (pin is not null && !PinPattern().IsMatch(pin))
            return null;

        return new InvitationData
        {
            ServerUrl = serverUrl,
            SpaceId = spaceId,
            Pin = pin
        };
    }

    /// <summary>
    /// Parses a full client URL containing a ?join= query parameter, or a raw invitation string.
    /// </summary>
    public static InvitationData? Parse(string input)
    {
        if (Uri.TryCreate(input, UriKind.Absolute, out var uri) && !string.IsNullOrEmpty(uri.Query))
        {
            var query = HttpUtility.ParseQueryString(uri.Query);
            var joinValue = query["join"];
            if (!string.IsNullOrEmpty(joinValue))
                return ParseInvitationString(joinValue);
        }

        return ParseInvitationString(input);
    }
}
