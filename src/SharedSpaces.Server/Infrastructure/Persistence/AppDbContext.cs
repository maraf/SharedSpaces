using Microsoft.EntityFrameworkCore;
using SharedSpaces.Server.Domain;

namespace SharedSpaces.Server.Infrastructure.Persistence;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Space> Spaces => Set<Space>();
    public DbSet<SpaceInvitation> SpaceInvitations => Set<SpaceInvitation>();
    public DbSet<SpaceMember> SpaceMembers => Set<SpaceMember>();
    public DbSet<SpaceItem> SpaceItems => Set<SpaceItem>();
    public DbSet<SharedLink> SharedLinks => Set<SharedLink>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);
        base.OnModelCreating(modelBuilder);
    }
}
