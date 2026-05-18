import pandas as pd

# load exported Tableau data
df = pd.read_csv("funding_awards_export.csv")

# FIX: Series.replace() does value substitution, not string replacement.
# Must use .str.replace() to manipulate string content within each cell.
df["Award Amount USD"] = (
    df["Award Amount USD"]
    .astype(str)
    .str.replace(",", "", regex=False)
    .astype(float)
)

# total funding
total_funding = df["Award Amount USD"].sum()

# top award row (highest amount)
top_row = df.loc[df["Award Amount USD"].idxmax()]

# average funding
avg_funding = df["Award Amount USD"].mean()

print("\nEXECUTIVE FUNDING SUMMARY")
print("-------------------------")

print(f"Total Research Funding: ${total_funding:,.0f}")

# FIX: 'Sponsor' column does not exist in the CSV.
# Using 'Award Date' as the identifier — update this to match your actual column name
# if you swap in a dataset that has a Sponsor column.
top_label_col = "Award Date" if "Award Date" in df.columns else df.columns[0]
print(f"\nTop Award Date: {top_row[top_label_col]}")
print(f"Funding Amount: ${top_row['Award Amount USD']:,.0f}")

print(f"\nAverage Award Amount: ${avg_funding:,.0f}")
