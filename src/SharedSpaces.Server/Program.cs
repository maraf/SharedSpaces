using SharedSpaces.Server.Infrastructure.Persistence;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddPersistence(builder.Configuration, builder.Environment.ContentRootPath);

var app = builder.Build();

await app.InitializeDatabaseAsync();

app.MapGet("/", () => Results.Ok(new
{
    Service = "SharedSpaces.Server",
    Status = "Ready"
}));

app.Run();
