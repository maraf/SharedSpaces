using Microsoft.AspNetCore.HttpOverrides;
using SharedSpaces.Server.Features.Admin;
using SharedSpaces.Server.Features.Hubs;
using SharedSpaces.Server.Features.Invitations;
using SharedSpaces.Server.Features.Items;
using SharedSpaces.Server.Features.SharedLinks;
using SharedSpaces.Server.Features.Spaces;
using SharedSpaces.Server.Features.Tokens;
using SharedSpaces.Server.Infrastructure;
using SharedSpaces.Server.Infrastructure.FileStorage;
using SharedSpaces.Server.Infrastructure.Persistence;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddPersistence(builder.Configuration, builder.Environment.ContentRootPath);
builder.Services.AddJwtAuthentication(builder.Configuration);
builder.Services.AddScoped<AdminAuthenticationFilter>();
builder.Services.AddOptions<StorageOptions>()
    .Bind(builder.Configuration.GetSection("Storage"))
    .Validate(options => !string.IsNullOrWhiteSpace(options.BasePath), "Storage:BasePath must be configured.")
    .ValidateOnStart();
builder.Services.AddSingleton<IFileStorage, LocalFileStorage>();
builder.Services.AddSingleton<ISpaceHubNotifier, SpaceHubNotifier>();
builder.Services.AddSignalR();
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto | ForwardedHeaders.XForwardedHost;
    options.KnownIPNetworks.Clear();
    options.KnownProxies.Clear();
});
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        var allowedOrigins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>() 
            ?? new[] { "http://localhost:5173", "https://localhost:5173" };

        var normalizedOrigins = allowedOrigins
            .Where(o => !string.IsNullOrWhiteSpace(o))
            .Select(o => o.Trim())
            .ToArray();

        var exactOrigins = new HashSet<string>(
            normalizedOrigins.Where(o => !o.Contains('*')),
            StringComparer.OrdinalIgnoreCase);
        var wildcardPatterns = normalizedOrigins.Where(o => o.Contains('*')).ToArray();

        policy.SetIsOriginAllowed(origin =>
                exactOrigins.Contains(origin) ||
                wildcardPatterns.Any(p => CorsOriginMatcher.IsWildcardMatch(origin, p)))
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials();
    });
});

var app = builder.Build();

await app.InitializeDatabaseAsync();

app.UseForwardedHeaders();
app.UseCors();
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
app.MapSharedLinkEndpoints();
app.MapHubEndpoints();

if (app.Environment.IsEnvironment("Testing"))
{
    app.MapGet("/test/protected", () => Results.Ok())
        .RequireAuthorization();
}

app.Run();

public partial class Program
{
}
