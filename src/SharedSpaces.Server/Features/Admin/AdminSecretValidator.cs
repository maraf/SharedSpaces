using System.Security.Cryptography;
using System.Text;

namespace SharedSpaces.Server.Features.Admin;

public interface IAdminSecretValidator
{
    bool IsAuthorized(HttpRequest request);
}

public sealed class AdminSecretValidator : IAdminSecretValidator
{
    private readonly byte[] _adminSecretBytes;

    public AdminSecretValidator(IConfiguration configuration)
    {
        var adminSecret = configuration["Admin:Secret"]
            ?? throw new InvalidOperationException("Admin:Secret not configured");
        _adminSecretBytes = Encoding.UTF8.GetBytes(adminSecret);
    }

    public bool IsAuthorized(HttpRequest request)
    {
        if (!request.Headers.TryGetValue("X-Admin-Secret", out var providedSecretValues)
            || providedSecretValues.Count != 1)
        {
            return false;
        }

        var providedSecretBytes = Encoding.UTF8.GetBytes(providedSecretValues[0] ?? string.Empty);
        return CryptographicOperations.FixedTimeEquals(providedSecretBytes, _adminSecretBytes);
    }
}
