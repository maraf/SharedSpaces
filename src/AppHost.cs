#:sdk Aspire.AppHost.Sdk@13.0.2
#:project .\SharedSpaces.Server\SharedSpaces.Server.csproj
#:package Aspire.Hosting.NodeJs@9.5.2

var builder = DistributedApplication.CreateBuilder(new DistributedApplicationOptions
{
    DashboardApplicationName = "SharedSpaces",
    Args = args,
});

var server = builder.AddProject<Projects.SharedSpaces_Server>("server");

var client = builder.AddNpmApp("client", "./SharedSpaces.Client", "dev")
    .WithHttpEndpoint(port: 5173, env: "PORT")
    .WithEnvironment("BROWSER", "none")
    .WaitFor(server);

server.WithEnvironment("Cors__Origins", client.GetEndpoint("http"));

builder.Build().Run();
