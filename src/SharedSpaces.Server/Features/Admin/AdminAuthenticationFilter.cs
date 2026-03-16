namespace SharedSpaces.Server.Features.Admin;

public class AdminAuthenticationFilter : IEndpointFilter
{
    private readonly string _adminSecret;

    public AdminAuthenticationFilter(IConfiguration configuration)
    {
        _adminSecret = configuration["Admin:Secret"] 
            ?? throw new InvalidOperationException("Admin:Secret not configured");
    }

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var httpContext = context.HttpContext;
        
        if (!httpContext.Request.Headers.TryGetValue("X-Admin-Secret", out var providedSecret))
        {
            return Results.Unauthorized();
        }

        if (providedSecret != _adminSecret)
        {
            return Results.Unauthorized();
        }

        return await next(context);
    }
}
