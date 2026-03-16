using System.Security.Cryptography;
using System.Text;

namespace SharedSpaces.Server.Features.Admin;

public class AdminAuthenticationFilter : IEndpointFilter
{
    private readonly byte[] _adminSecretBytes;

    public AdminAuthenticationFilter(IConfiguration configuration)
    {
        var adminSecret = configuration["Admin:Secret"] 
            ?? throw new InvalidOperationException("Admin:Secret not configured");
        _adminSecretBytes = Encoding.UTF8.GetBytes(adminSecret);
    }

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var httpContext = context.HttpContext;

        if (!httpContext.Request.Headers.TryGetValue("X-Admin-Secret", out var providedSecretValues)
            || providedSecretValues.Count != 1)
        {
            return Results.Unauthorized();
        }

        var providedSecretBytes = Encoding.UTF8.GetBytes(providedSecretValues[0] ?? string.Empty);
        if (!CryptographicOperations.FixedTimeEquals(providedSecretBytes, _adminSecretBytes))
        {
            return Results.Unauthorized();
        }

        return await next(context);
    }
}
