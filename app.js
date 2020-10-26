require('dotenv').config();
const mongoose = require('mongoose');
const ejs = require('ejs');
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const findOrCreate = require('mongoose-findorcreate');
const passport = require('passport');
const passportLocalMongoose = require('passport-local-mongoose');
const GoogleStrategy = require('passport-google-oauth20');

const app = express();

app.use(express.static("public"));
app.set("view engine", "ejs");
app.use(bodyParser.urlencoded({
  extended: true
}));

app.use(session({
  secret: "Our little secret.",
  resave: false,
  saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

// Change Database object based on if using local or online version

// mongoose.connect('mongodb://localhost:27017/budgetDB', {
//   useNewUrlParser: true,
//   useUnifiedTopology: true
// });

mongoose.connect(process.env.DATABASE_STRING, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

const transactionSchema = new mongoose.Schema({
  name: String,
  date: String,
  description: String,
  amount: Number,
  type: String,
  category: String
});

const Transaction = mongoose.model("Transaction", transactionSchema);

const budgetSchema = new mongoose.Schema({
  name: String,
  description: String,
  transactions: [transactionSchema],
  total: Number,
  categories: [String]
});

const Budget = mongoose.model("Budget", budgetSchema);

const userSchema = new mongoose.Schema({
  googleId: {
    type: String,
    unique: true
  },
  password: String,
  email: {
    type: String,
    unique: true
  },
  budgets: [budgetSchema]
});

userSchema.plugin(passportLocalMongoose);
userSchema.plugin(findOrCreate);

const User = mongoose.model("User", userSchema);

passport.use(User.createStrategy());

passport.serializeUser(function(user, done) {
  done(null, user.id);
});

passport.deserializeUser(function(id, done) {
  User.findById(id, function(err, user) {
    done(err, user);
  });
});

let userProfileName;

passport.use(new GoogleStrategy({
    clientID: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    //Change callbackURL based on if using local or online version
    // callbackURL: "http://localhost:3000/auth/google/budgets",
    callbackURL: "https://whispering-lowlands-05174.herokuapp.com/auth/google/budgets",
    userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo"
  },
  function(accessToken, refreshToken, profile, cb) {
    // console.log(profile);
    userProfileName = profile._json.given_name;
    // console.log(userProfileName);
    User.findOrCreate({
      googleId: profile.id
    }, function(err, user) {
      return cb(err, user);
    });
  }
));

app.get('/auth/google',
  passport.authenticate('google', {
    scope: ['profile']
  })
);

app.get('/auth/google/budgets',
  passport.authenticate('google', {
    failureRedirect: '/'
  }),
  function(req, res) {
    // Successful authentication, redirect home.
    // console.log("Authentication Success Before Redirect");
    res.redirect('/budgets');
  });

// Load Home

app.get("/", function(req, res) {
  if (req.isAuthenticated()) {
    res.redirect("/budgets");
  } else {
    res.render('home');
  }
});

// Load Budgets

app.get("/budgets", function(req, res) {
  // console.log(req.isAuthenticated());

  //   db.getCollection('users').aggregate([
  //     { $match: { _id: ObjectId("5f3dd0ff56f31e6b684e78c8")} },
  //     { $unwind: "$budgets" },
  //     { $unwind: "$budgets.transactions" },
  //     { $group : {
  //         _id :  { transactionType : "$budgets.transactions.type",
  //         budgetId : "$budgets._id"},
  //         "Total" : {$sum : "$budgets.transactions.amount"}
  //     } }
  // ])

  if (req.isAuthenticated()) {
    // console.log("Successful Authentication");
    // console.log(userProfileName);
    let userHeading = "";
    if (userProfileName === "") {
      userHeading = "Welcome!";
    } else {
      userHeading = "Welcome, " + userProfileName + "!";
    }
    User.findById(req.user.id, function(err, foundUser) {
      if (err) {
        console.log(err);
      } else {
        if (foundUser) {
          // console.log(foundUser.budgets);

          res.render("budgets", {
            userBudgets: foundUser.budgets,
            userName: userHeading
          });
        }
      }
    });
  } else {
    console.log("Failed Authentication");
    res.redirect("/");
  }
});

// Create new Budget

app.post("/budgets", function(req, res) {
  // const newBudget = req.body.budgetName;

  const newBudget = new Budget({
    name: req.body.budgetName,
    total: 0
  });

  // console.log(req.user.id);

  User.findById(req.user.id, function(err, foundUser) {
    foundUser.budgets.push(newBudget);
    foundUser.save();
    res.redirect("/budgets");
  });

});

// Delete Budget

app.get("/delete/:budgetId", function(req, res) {
  if (req.isAuthenticated()) {
    // console.log("test");
    const budgetId = req.params.budgetId;
    // console.log(budgetId);

    User.findById(req.user.id, function(err, foundUser) {
      foundUser.budgets.id(budgetId).remove();
      foundUser.save();
      res.redirect("/budgets");
    });
    // res.redirect("/budgets");
  } else {
    console.log("Failed Authentication");
    res.redirect("/");
  }
});

// Delete Transaction

app.get("/delete/:budgetId/:transactionId", function(req, res) {

  const budgetId = req.params.budgetId;
  // console.log("Budget ID: " + budgetId);
  const transactionId = req.params.transactionId;

  User.findById(req.user.id, function(err, foundUser) {
    const foundBudget = foundUser.budgets.id(budgetId);
    // console.log("Found budget: " + foundBudget);

    const transType = foundBudget.transactions.id(transactionId).type;
    const transAmount = foundBudget.transactions.id(transactionId).amount;

    switch (transType) {
      case 'Deposit':
        foundBudget.total = foundBudget.total - transAmount;
        break;
      case 'Withdrawal':
        foundBudget.total = foundBudget.total + transAmount;
        break;
      case 'Payment':
        foundBudget.total = foundBudget.total + transAmount;
        break;
    }

    foundBudget.transactions.id(transactionId).remove();
    foundUser.save();
    // console.log("Successful Delete");
    // console.log(foundBudget.transactions);
    res.redirect("/budgets/" + budgetId);
  });
});

//Update Transaction

app.post("/update/:budgetId/:transactionId", function(req, res) {

  if (req.isAuthenticated()) {

    const budgetId = req.params.budgetId;
    // console.log("Budget ID: " + budgetId);
    const transactionId = req.params.transactionId;
    const newName = req.body.transactionName;
    const newDesc = req.body.transactionDesc;
    const newAmount = req.body.transactionAmount;
    const newDate = req.body.transactionDate;
    const newCategory = req.body.category;

    User.findById(req.user.id, function(err, foundUser) {
      const foundBudget = foundUser.budgets.id(budgetId);
      // console.log("Found budget: " + foundBudget);
      const foundTransactions = foundBudget.transactions;
      if (newName) {
        foundBudget.transactions.id(transactionId).name = newName;
      }
      if (newDesc) {
        foundBudget.transactions.id(transactionId).description = newDesc;
      }
      if (newAmount) {
        const transType = foundBudget.transactions.id(transactionId).type;
        const transAmount = foundBudget.transactions.id(transactionId).amount;
        switch (transType) {
          case 'Deposit':
            foundBudget.total = (foundBudget.total - transAmount) + newAmount;
            break;
          case 'Withdrawal':
            foundBudget.total = (foundBudget.total + transAmount) - newAmount;
            break;
          case 'Payment':
            foundBudget.total = (foundBudget.total + transAmount) - newAmount;
            break;
        }

        foundBudget.transactions.id(transactionId).amount = newAmount;
      }
      if (newDate) {
        foundBudget.transactions.id(transactionId).date = newDate;
      }
      if (newCategory) {
        foundBudget.transactions.id(transactionId).category = newCategory;
      }

      foundUser.save();

      res.redirect("/budgets/" + budgetId);
    });
  } else {
    res.redirect("/");
  }
});

// Update Budget

app.post("/update/:budgetId", function(req, res) {
  if (req.isAuthenticated()) {
    const budgetId = req.params.budgetId;

    const newName = req.body.budgetName;
    const newDesc = req.body.budgetDesc;
    // console.log("User ID: " + req.user.id);
    User.findById(req.user.id, function(err, foundUser) {

      if (err) {
        console.log(err);
      } else {
        // console.log("This is a user: " + foundUser);
        const foundBudget = foundUser.budgets.id(budgetId);
        // console.log("Found Budget: " + foundBudget);
        if (newName) {
          foundBudget.name = newName;
        }
        if (newDesc) {
          foundBudget.description = newDesc;
        }

        foundUser.save();

        res.redirect("/budgets");
      }
    })
  } else {
    res.redirect("/");
  }
});

// Load Transactions

app.get("/budgets/:budgetId", function(req, res) {
  // console.log(req.params.budgetId);
  const budgetId = req.params.budgetId;
  // console.log(req.isAuthenticated());
  if (req.isAuthenticated()) {
    User.findById(req.user.id, function(err, foundUser) {
      // console.log(foundUser);
      const foundBudget = foundUser.budgets.id(budgetId);
      const foundTransactions = foundBudget.transactions;

      // //Find total of transactions for this user's budget

      let userDeposits = 0;
      let userWithdrawals = 0;
      let userPayments = 0;

      // const foundTransactions = foundBudget.transactions;
      // console.log("Found Transactions: " + foundBudget.transactions);


      foundTransactions.forEach((element) => {
        // console.log(element.type);
        switch (element.type) {
          case 'Deposit':
            userDeposits = element.amount + userDeposits;
            break;
          case 'Withdrawal':
            userWithdrawals = element.amount + userWithdrawals;
            break;
          case 'Payment':
            userPayments = element.amount + userPayments;
            break;
        }
      });

      // console.log("Deposit Total: " + userDeposits);
      // console.log("Withdrawal Total: " + userWithdrawals);
      // console.log("Payment Total: " + userPayments);

      const total = userDeposits - (userWithdrawals + userPayments);

      // console.log("Calculated Total: " + total);

      foundBudget.total = total;
      foundUser.save();
      // //End of Find total transactions for this user's budget;

      res.render("transactions", {
        budgetTransactions: foundTransactions,
        budgetName: foundBudget.name,
        budgetId: foundBudget.id,
        budgetCategories: foundBudget.categories,
        budgetTotal: foundBudget.total,
        categoryTotal: foundBudget.total
      });
    });
  } else {
    res.redirect("/");
  }

  // res.redirect("/transactions", {userBudget: req.body.budgetId});
});

// Load Transactions based on Category

app.get("/budgets/:budgetId/:category", function(req, res) {
  // console.log(req.params.budgetId);
  if (req.isAuthenticated()) {
    const budgetId = req.params.budgetId;
    const selectedCategory = req.params.category;
    let categoryTotal = 0;
    let userDeposits = 0;
    let userWithdrawals = 0;
    let userPayments = 0;

    // console.log(req.isAuthenticated());


    User.findById(req.user.id, function(err, foundUser) {
      // console.log(foundUser);
      const foundBudget = foundUser.budgets.id(budgetId);
      const foundTransactions = foundBudget.transactions;
      const selectedTransactions = new Array();

      foundTransactions.forEach(element => {
        if (element.category === selectedCategory) {
          selectedTransactions.push(element);

          switch (element.type) {
            case 'Deposit':
              userDeposits = element.amount + userDeposits;
              break;
            case 'Withdrawal':
              userWithdrawals = element.amount + userWithdrawals;
              break;
            case 'Payment':
              userPayments = element.amount + userPayments;
              break;
          }

          categoryTotal = userDeposits - (userWithdrawals + userPayments);
        }
      });

      foundUser.save();
      // //End of Find total transactions for this user's budget;

      res.render("transactions", {
        budgetTransactions: selectedTransactions,
        budgetName: foundBudget.name,
        budgetId: foundBudget.id,
        budgetCategories: foundBudget.categories,
        budgetTotal: foundBudget.total,
        categoryTotal: categoryTotal
      });
    });
  } else {
    res.redirect("/");
  }
});

// Create Category for Transactions

app.post("/transactions/category/:budgetId", function(req, res) {
  if (req.isAuthenticated()) {
    const budgetId = req.params.budgetId;

    const newCategory = req.body.newCategory;
    // console.log("User ID: " + req.user.id);
    User.findById(req.user.id, function(err, foundUser) {

      if (err) {
        console.log(err);
      } else {
        // console.log("This is a user: " + foundUser);
        const foundBudget = foundUser.budgets.id(budgetId);
        // console.log("Found Budget: " + foundBudget);
        if (newCategory) {
          foundBudget.categories.push(newCategory);
        }

        foundUser.save();

        res.redirect("/budgets/" + budgetId);
      }
    })
  } else {
    res.redirect("/");
  }
});

// Delete Category for Transactions

app.get("/budgets/:budgetId/delete/:category", function(req, res) {

  if (req.isAuthenticated()) {
    const budgetId = req.params.budgetId;

    const category = req.params.category;
    // console.log("User ID: " + req.user.id);
    User.findById(req.user.id, function(err, foundUser) {

      if (err) {
        console.log(err);
      } else {
        // console.log("This is a user: " + foundUser);
        const foundBudget = foundUser.budgets.id(budgetId);
        // console.log("Found Budget: " + foundBudget);
        if (category) {
          foundBudget.categories.remove(category);
        }

        foundUser.save();

        res.redirect("/budgets/" + budgetId);
      }
    })
  } else {
    res.redirect("/");
  }
});

// Create Transactions

app.post("/transactions/:budgetId", function(req, res) {

  newCategory = req.body.category;

  if ((newCategory === "") || (newCategory === "None")) {
    newCategory = "None";
  }

  // console.log(newCategory);

  if (req.isAuthenticated()) {
    const newTransaction = new Transaction({
      name: req.body.transactionName,
      description: req.body.transactionDesc,
      amount: req.body.transactionAmount,
      type: req.body.transactionType,
      date: req.body.transactionDate,
      category: newCategory
    });

    // console.log("User ID: " + req.user.id);

    const budgetId = req.params.budgetId;

    // console.log("Budget ID : " + budgetId);

    User.findById(req.user.id, function(err, foundUser) {
      const foundBudget = foundUser.budgets.id(budgetId);
      // console.log("Found budget: " + foundBudget);

      // Test update Total
      const transType = newTransaction.type;
      const transAmount = newTransaction.amount;

      switch (transType) {
        case 'Deposit':
          foundBudget.total = foundBudget.total + transAmount;
          break;
        case 'Withdrawal':
          foundBudget.total = foundBudget.total - transAmount;
          break;
        case 'Payment':
          foundBudget.total = foundBudget.total - transAmount;
          break;
      }
      // End Test update Total

      foundBudget.transactions.push(newTransaction);

      foundUser.save();
      // console.log(foundBudget.transactions);
      res.redirect("/budgets/" + budgetId);
    });
  } else {
    res.redirect("/");
  }
});

// Logout

app.get("/logout", function(req, res) {
  req.logout();
  res.redirect("/");
});

// Server Status

let port = process.env.PORT;

if (port == null || port == "") {
  port = 3000;
}

app.listen(port, function(req, res) {
  console.log("Server is listening.");
});
