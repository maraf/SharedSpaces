#:sdk Aspire.AppHost.Sdk@13.4.6
#:project .\SharedSpaces.Server\SharedSpaces.Server.csproj
#:package Aspire.Hosting.NodeJs@9.5.2

var builder = DistributedApplication.CreateBuilder(new DistributedApplicationOptions
{
    DashboardApplicationName = "SharedSpaces",
    Args = args,
});

var server = builder.AddProject<Projects.SharedSpaces_Server>("server");

var screenshotsDb = builder.Configuration["ConnectionStrings:DefaultConnection"];
if (!string.IsNullOrEmpty(screenshotsDb))
{
    server.WithEnvironment("ConnectionStrings__DefaultConnection", screenshotsDb);
}

var storagePath = builder.Configuration["Storage:BasePath"];
if (!string.IsNullOrEmpty(storagePath))
{
    server.WithEnvironment("Storage__BasePath", storagePath);
}

var useDeterministicScreenshotTime = bool.TryParse(
    builder.Configuration["Screenshots:UseDeterministicTime"],
    out var deterministicTimeEnabled)
    && deterministicTimeEnabled;
if (useDeterministicScreenshotTime)
{
    var deterministicSeededUtcNow = builder.Configuration["DeterministicTime:SeededUtcNow"]
        ?? "2025-03-19T12:00:00Z";
    server.WithEnvironment("DeterministicTime__SeededUtcNow", deterministicSeededUtcNow);

    var deterministicAutoAdvanceSeconds = builder.Configuration["DeterministicTime:AutoAdvanceSeconds"]
        ?? "60";
    server.WithEnvironment("DeterministicTime__AutoAdvanceSeconds", deterministicAutoAdvanceSeconds);
}

var client = builder.AddNpmApp("client", "./SharedSpaces.Client", "dev")
    .WithHttpEndpoint(port: 5173, env: "PORT")
    .WithEnvironment("BROWSER", "none")
    .WaitFor(server);

server.WithEnvironment("Cors__Origins__0", client.GetEndpoint("http"));

builder.Build().Run();
