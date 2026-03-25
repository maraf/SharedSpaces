using System.CommandLine;
using SharedSpaces.Cli.Commands;

var rootCommand = new RootCommand("SharedSpaces CLI — join spaces and sync files");
rootCommand.Add(JoinCommand.Create());
rootCommand.Add(UploadCommand.Create());

var config = new CommandLineConfiguration(rootCommand);
return await config.InvokeAsync(args);
