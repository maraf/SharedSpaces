using System.Security.Cryptography;
using System.Text;

namespace SharedSpaces.Server.Features.Invitations;

internal static class InvitationPinHasher
{
    public static string HashPin(string pin, string adminSecret)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(adminSecret));
        var bytes = hmac.ComputeHash(Encoding.UTF8.GetBytes(pin));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }
}
