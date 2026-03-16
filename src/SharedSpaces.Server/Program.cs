using SharedSpaces.Server.Features.Admin;
using SharedSpaces.Server.Features.Invitations;
using SharedSpaces.Server.Features.Spaces;
using SharedSpaces.Server.Infrastructure.Persistence;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddPersistence(builder.Configuration, builder.Environment.ContentRootPath);
builder.Services.AddScoped<AdminAuthenticationFilter>();

var app = builder.Build();

await app.InitializeDatabaseAsync();

app.MapGet("/", () => Results.Ok(new
{
    Service = "SharedSpaces.Server",
    Status = "Ready"
}));

app.MapSpaceEndpoints();
app.MapInvitationEndpoints();

app.Run();
