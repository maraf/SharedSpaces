namespace SharedSpaces.Server.Features.Hubs;

public static class HubEndpoints
{
    public static IEndpointRouteBuilder MapHubEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapHub<SpaceHub>("/v1/spaces/{spaceId}/hub");
        return app;
    }
}
