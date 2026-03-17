using SharedSpaces.Server.Features.Admin;
using SharedSpaces.Server.Features.Invitations;
using SharedSpaces.Server.Features.Items;
using SharedSpaces.Server.Features.Spaces;
using SharedSpaces.Server.Features.Tokens;
using SharedSpaces.Server.Infrastructure.FileStorage;
using SharedSpaces.Server.Infrastructure.Persistence;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddPersistence(builder.Configuration, builder.Environment.ContentRootPath);
builder.Services.AddJwtAuthentication(builder.Configuration);
builder.Services.AddScoped<AdminAuthenticationFilter>();
builder.Services.Configure<StorageOptions>(builder.Configuration.GetSection("Storage"));
builder.Services.AddSingleton<IFileStorage, LocalFileStorage>();

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
app.MapItemEndpoints();

if (app.Environment.IsEnvironment("Testing"))
{
    app.MapGet("/test/protected", () => Results.Ok())
        .RequireAuthorization();
}

app.Run();

public partial class Program
{
}
