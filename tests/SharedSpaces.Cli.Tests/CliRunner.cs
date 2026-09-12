using System.CommandLine;
using System.CommandLine.Parsing;
using SharedSpaces.Cli;

namespace SharedSpaces.Cli.Tests;

/// <summary>
/// Invokes the CLI in-process while capturing console streams. Console redirection is
/// process-global, so tests using this helper must run in the non-parallel
/// <see cref="CliCollection"/>.
/// </summary>
internal static class CliRunner
{
    public static async Task<CliResult> RunAsync(string[] args, string? stdin = null)
    {
        var originalOut = Console.Out;
        var originalError = Console.Error;
        var originalIn = Console.In;

        var stdout = new StringWriter();
        var stderr = new StringWriter();

        try
        {
            Console.SetOut(stdout);
            Console.SetError(stderr);
            Console.SetIn(new StringReader(stdin ?? string.Empty));

            var parseResult = CommandLineParser.Parse(CliApplication.CreateRootCommand(), args);
            var exitCode = await parseResult.InvokeAsync(new InvocationConfiguration
            {
                Output = stdout,
                Error = stderr,
                EnableDefaultExceptionHandler = true,
            });

            return new CliResult(exitCode, stdout.ToString(), stderr.ToString());
        }
        finally
        {
            Console.SetOut(originalOut);
            Console.SetError(originalError);
            Console.SetIn(originalIn);
        }
    }
}

internal sealed record CliResult(int ExitCode, string StdOut, string StdErr);
