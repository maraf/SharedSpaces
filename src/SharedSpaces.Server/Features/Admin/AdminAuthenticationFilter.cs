namespace SharedSpaces.Server.Features.Admin;

public class AdminAuthenticationFilter(IAdminSecretValidator adminSecretValidator) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var httpContext = context.HttpContext;

        if (!adminSecretValidator.IsAuthorized(httpContext.Request))
        {
            return Results.Unauthorized();
        }

        return await next(context);
    }
}
