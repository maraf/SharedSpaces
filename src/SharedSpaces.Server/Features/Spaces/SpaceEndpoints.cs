using Microsoft.EntityFrameworkCore;
using SharedSpaces.Server.Domain;
using SharedSpaces.Server.Features.Admin;
using SharedSpaces.Server.Infrastructure.Persistence;

namespace SharedSpaces.Server.Features.Spaces;

public static class SpaceEndpoints
{
    public static IEndpointRouteBuilder MapSpaceEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/v1/spaces");

        group.MapGet("/", GetSpaces)
            .AddEndpointFilter<AdminAuthenticationFilter>();

        group.MapPost("/", CreateSpace)
            .AddEndpointFilter<AdminAuthenticationFilter>();

        return app;
    }

    private static async Task<IResult> GetSpaces(AppDbContext db)
    {
        var response = await db.Spaces
            .AsNoTracking()
            .OrderByDescending(space => space.CreatedAt)
            .Select(space => new SpaceResponse(space.Id, space.Name, space.CreatedAt))
            .ToListAsync();

        return Results.Ok(response);
    }

    private static async Task<IResult> CreateSpace(
        CreateSpaceRequest request,
        AppDbContext db)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return Results.BadRequest(new { Error = "Name is required" });
        }

        if (request.Name.Length > 200)
        {
            return Results.BadRequest(new { Error = "Name must not exceed 200 characters" });
        }

        var space = new Space
        {
            Name = request.Name.Trim()
        };

        db.Spaces.Add(space);
        await db.SaveChangesAsync();

        var response = new SpaceResponse(space.Id, space.Name, space.CreatedAt);
        return Results.Created($"/v1/spaces/{space.Id}", response);
    }
}
