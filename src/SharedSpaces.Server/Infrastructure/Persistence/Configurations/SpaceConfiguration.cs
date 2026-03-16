using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SharedSpaces.Server.Domain;

namespace SharedSpaces.Server.Infrastructure.Persistence.Configurations;

public class SpaceConfiguration : IEntityTypeConfiguration<Space>
{
    public void Configure(EntityTypeBuilder<Space> builder)
    {
        builder.ToTable("Spaces");

        builder.HasKey(space => space.Id);

        builder.Property(space => space.Id)
            .ValueGeneratedNever();

        builder.Property(space => space.Name)
            .HasMaxLength(200)
            .IsRequired();

        builder.Property(space => space.CreatedAt)
            .IsRequired();
    }
}
