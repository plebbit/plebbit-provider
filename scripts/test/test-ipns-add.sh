# add to ipfs
cid=$(echo '{"signature": {}}' | IPFS_PATH=.ipfs bin/ipfs add --quieter --pin=false)
cid=$(IPFS_PATH=.ipfs bin/ipfs cid base32 $cid)
IPFS_PATH=.ipfs bin/ipfs pin add $cid

# gen key
IPFS_PATH=.ipfs bin/ipfs key rm test-ipns-add
IPFS_PATH=.ipfs bin/ipfs key gen test-ipns-add

# publish name
ipns_name=$(IPFS_PATH=.ipfs bin/ipfs name publish /ipfs/$cid --ttl 60s --lifetime 999999h --key=test-ipns-add --quieter)

curl -v localhost:8000/ipns/$ipns_name
