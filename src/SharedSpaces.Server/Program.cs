using SharedSpaces.Server.Features.Admin;
using SharedSpaces.Server.Features.Invitations;
using SharedSpaces.Server.Features.Spaces;
using SharedSpaces.Server.Features.Tokens;
using SharedSpaces.Server.Infrastructure.Persistence;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddPersistence(builder.Configuration, builder.Environment.ContentRootPath);
builder.Services.AddJwtAuthentication(builder.Configuration);
builder.Services.AddScoped<AdminAuthenticationFilter>();

var app = builder.Build();

await app.InitializeDatabaseAsync();

app.UseAuthentication();
app.UseSpaceMemberAuthorization();
app.UseAuthorization();

app.MapGet("/", () => Results.Ok(new
{
    Service = "SharedSpaces.Server",
    Status = "Ready"
}));

app.MapSpaceEndpoints();
app.MapInvitationEndpoints();
app.MapTokenEndpoints();

app.Run();

public partial class Program
{
}
