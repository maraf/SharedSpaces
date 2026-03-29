using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using SharedSpaces.Server.Infrastructure.Persistence;

namespace SharedSpaces.Server.Tests;

public class MigrationSnapshotTests
{
    [Fact]
    public void MigrationSnapshot_ShouldMatchCurrentModel()
    {
        // Arrange: Create a DbContext with SQLite to get proper services
        var optionsBuilder = new DbContextOptionsBuilder<AppDbContext>();
        optionsBuilder.UseSqlite("DataSource=:memory:");
        
        using var context = new AppDbContext(optionsBuilder.Options);

        // Act: Get the migrations model differ and assembly services
        var modelDiffer = context.GetInfrastructure().GetRequiredService<IMigrationsModelDiffer>();
        var migrationsAssembly = context.GetInfrastructure().GetRequiredService<IMigrationsAssembly>();
        var modelRuntimeInitializer = context.GetInfrastructure().GetRequiredService<IModelRuntimeInitializer>();
        
        // Get the snapshot model from the last migration
        var snapshotModelSource = migrationsAssembly.ModelSnapshot?.Model;
        snapshotModelSource.Should().NotBeNull("AppDbContextModelSnapshot should exist");

        // Get the current model at design time
        var modelSource = context.GetInfrastructure().GetRequiredService<IModelSource>();
        var currentModelSource = modelSource.GetModel(context, modelCreationDependencies: null!, designTime: true);

        // Initialize both models for comparison (design-time models have design-time annotations)
        var snapshotModel = modelRuntimeInitializer.Initialize(
            snapshotModelSource!,
            designTime: true,
            validationLogger: null);
            
        var currentModel = modelRuntimeInitializer.Initialize(
            currentModelSource,
            designTime: true,
            validationLogger: null);

        // Use the HasDifferences method to compare
        var hasDifferences = modelDiffer.HasDifferences(
            snapshotModel.GetRelationalModel(),
            currentModel.GetRelationalModel());

        // Assert: No differences should exist
        hasDifferences.Should().BeFalse(
            "The current DbContext model must match the last migration snapshot. " +
            "If this test fails, you need to add a new migration using: " +
            "dotnet ef migrations add <MigrationName> --project src/SharedSpaces.Server --startup-project src/SharedSpaces.Server");
    }
}
